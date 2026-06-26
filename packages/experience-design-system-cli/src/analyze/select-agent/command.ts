import type { Command } from 'commander';
import {
  openPipelineDb,
  loadRawComponents,
  loadScannedFiles,
  createStep,
  updateStep,
  computeComponentInputHash,
  lookupSelectCache,
  storeSelectCache,
  getCliCacheVersion,
  type RawComponentWithId,
} from '../../session/db.js';
import { hashPromptForSkill } from '../../session/cache-keys.js';
import {
  appendReviewEvent,
  getRefineArtifactsRoot,
  ensureRefineSession,
  getRefineSessionPaths,
  saveReviewState,
} from '../select/persistence.js';
import { loadReviewInput } from '../select/parser.js';
import type { ReviewSessionSnapshot } from '../select/types.js';
import { buildPrompt } from '../../generate/prompt-builder.js';
import { formatCustomPromptBanner } from '../../generate/command.js';
import { parseSelectToolCallLines, runAgent } from '../../generate/agent-runner.js';
import { access } from 'node:fs/promises';
import type { AgentName, SelectToolCall } from '../../generate/agent-runner.js';
import type { RawComponentDefinition } from '../../types.js';
import { readExperiencesCredentials } from '../../credentials-store.js';
import { OutputFormatter, c } from '../../output/format.js';
import { buildRepoContextIndex, buildSelectionContext, type SelectionContext } from './context-builder.js';
import { runShowRationale } from './show-rationale.js';
import { isAbsolute, resolve } from 'node:path';
import {
  validateExtractedComponents,
  shouldExcludeDueToValidation,
  formatExclusionWarning,
} from '../extract/validate.js';

const VALID_AGENTS = new Set<string>(['claude', 'codex', 'opencode', 'cursor']);
const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 3 * 60 * 1000);
export const DEFAULT_CONCURRENCY = 10;
export const DEFAULT_BATCH_SIZE = 5;

function resolveBatchSize(): number {
  const raw = process.env.EDS_SELECT_BATCH_SIZE;
  if (!raw) return DEFAULT_BATCH_SIZE;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_BATCH_SIZE;
  return Math.floor(n);
}

function resolveSessionId(sessionFlag: string | undefined): string {
  if (sessionFlag) return sessionFlag;

  const db = openPipelineDb();
  try {
    const row = db
      .prepare(
        `SELECT s.id FROM sessions s
         JOIN steps st ON st.session_id = s.id
         WHERE st.command = 'analyze extract'
           AND st.status = 'complete'
         ORDER BY st.started_at DESC
         LIMIT 1`,
      )
      .get() as { id: string } | undefined;

    if (!row) {
      process.stderr.write(
        'Error: no completed analyze extract session found. Run analyze extract first, or pass --session <id>.\n',
      );
      process.exit(1);
    }
    return row.id;
  } finally {
    db.close();
  }
}

interface SelectOneResult {
  componentKey: string;
  componentName: string;
  decision: 'accepted' | 'rejected' | null;
  reason?: string;
  failed: boolean;
}

type SelectionCandidate = {
  component: RawComponentDefinition & { component_id?: string };
  selectionContext?: SelectionContext;
};

function componentKey(component: Pick<RawComponentDefinition, 'name' | 'source'>): string {
  return `${component.name}::${component.source}`;
}

function buildComponentData(candidate: SelectionCandidate) {
  const { component, selectionContext } = candidate;
  const payload: Record<string, unknown> = {
    name: component.name,
    source: component.source,
    framework: component.framework,
    propCount: component.props.length,
    slotCount: component.slots.length,
    propNames: component.props.slice(0, 8).map((p) => p.name),
    props: component.props,
    slots: component.slots,
    extractionConfidence: component.extractionConfidence ?? null,
    needsReview: component.needsReview ?? false,
  };

  if (component.reviewReasons && component.reviewReasons.length > 0) {
    payload.reviewReasons = component.reviewReasons;
  }

  if (selectionContext) {
    payload.selectionContext = selectionContext;
  }

  return payload;
}

function resolveProjectRoot(sessionId: string, projectRootFlag: string | undefined): string | null {
  if (projectRootFlag) return resolve(projectRootFlag);

  const db = openPipelineDb();
  try {
    const row = db
      .prepare(
        `SELECT inputs FROM steps
         WHERE session_id = ?
           AND command = 'analyze extract'
         ORDER BY started_at DESC
         LIMIT 1`,
      )
      .get(sessionId) as { inputs: string } | undefined;

    if (!row?.inputs) return null;
    const parsed = JSON.parse(row.inputs) as { project?: string };
    return parsed.project ? resolve(parsed.project) : null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

type BatchItem = {
  candidate: SelectionCandidate;
  // Absolute index in the full components array — used for progress N/M.
  index: number;
};

async function selectBatch(
  agent: AgentName,
  model: string | undefined,
  batch: BatchItem[],
  total: number,
  verbose: boolean,
  skillPathOverride: string | undefined,
): Promise<SelectOneResult[]> {
  const prompt = await buildPrompt({
    skill: 'select',
    mode: 'autonomous',
    rawComponentsInline: JSON.stringify(batch.map((b) => buildComponentData(b.candidate)), null, 2),
    outDir: process.cwd(),
    skillPathOverride,
  });

  let outputBuf = '';
  const formatter = new OutputFormatter(verbose, (s) => {
    outputBuf += s;
  });

  const result = await runAgent({
    agent,
    model,
    prompt,
    interactive: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    onOutput: (chunk) => formatter.push(chunk),
  });
  formatter.flush();

  if (verbose) {
    const names = batch.map((b) => b.candidate.component.name).join(', ');
    process.stderr.write(`  ${c.bold(`batch: ${names}`)}\n${outputBuf}`);
  }

  // Feature 3: emit one progress= line per component (in input order) regardless
  // of batch outcome. The wizard's runAutoFilter parser depends on this contract.
  const emitProgress = (
    item: BatchItem,
    decision: 'accepted' | 'rejected',
    reason: string | undefined,
  ): void => {
    const reasonEncoded = reason ? encodeURIComponent(reason) : '';
    process.stderr.write(
      `progress=select-agent:${item.index + 1}/${total}:${decision}:${item.candidate.component.name}:${reasonEncoded}\n`,
    );
  };

  // Whole-batch failure: timeout or non-zero exit. Mark every item failed and
  // do NOT emit progress lines (no decision was made).
  if (result.timedOut) {
    for (const item of batch) {
      const pos = c.dim(`[${item.index + 1}/${total}]`);
      process.stderr.write(`  ${pos}  ${c.bold(item.candidate.component.name)}  ${c.yellow('timed out')}\n`);
    }
    return batch.map((item) => ({
      componentKey: componentKey(item.candidate.component),
      componentName: item.candidate.component.name,
      decision: null,
      failed: true,
    }));
  }

  if (result.exitCode !== 0) {
    for (const item of batch) {
      const pos = c.dim(`[${item.index + 1}/${total}]`);
      process.stderr.write(
        `  ${pos}  ${c.bold(item.candidate.component.name)}  ${c.red(`agent exited with code ${result.exitCode}`)}\n`,
      );
    }
    return batch.map((item) => ({
      componentKey: componentKey(item.candidate.component),
      componentName: item.candidate.component.name,
      decision: null,
      failed: true,
    }));
  }

  const { calls, warnings } = parseSelectToolCallLines(result.stdout);

  if (warnings.length > 0) {
    for (const warning of warnings) {
      process.stderr.write(`  ${c.yellow('⚠')}  batch: ${warning}\n`);
    }
  }

  const results: SelectOneResult[] = [];
  for (const item of batch) {
    const { component } = item.candidate;
    const pos = c.dim(`[${item.index + 1}/${total}]`);
    const call = calls.find((toolCall): toolCall is SelectToolCall => toolCall.name === component.name);

    if (!call) {
      process.stderr.write(`  ${pos}  ${c.bold(component.name)}  ${c.yellow('no tool call')}\n`);
      results.push({
        componentKey: componentKey(component),
        componentName: component.name,
        decision: null,
        failed: true,
      });
      continue;
    }

    const decision = call.tool === 'select_component' ? 'accepted' : 'rejected';
    const finalColor = decision === 'accepted' ? c.green : c.red;
    process.stderr.write(
      `  ${pos}  ${c.bold(component.name)}  ${finalColor(decision)}${call.reason ? `  ${c.dim(call.reason)}` : ''}\n`,
    );
    emitProgress(item, decision, call.reason);

    results.push({
      componentKey: componentKey(component),
      componentName: component.name,
      decision,
      reason: call.reason,
      failed: false,
    });
  }

  return results;
}

async function selectAllComponents(
  agent: AgentName,
  model: string | undefined,
  components: SelectionCandidate[],
  verbose: boolean,
  skillPathOverride: string | undefined,
  cacheConfig: { noCache: boolean; dbPath?: string } = { noCache: true },
): Promise<SelectOneResult[]> {
  const concurrency = Number(process.env.EDS_GENERATE_CONCURRENCY ?? DEFAULT_CONCURRENCY);
  const batchSize = resolveBatchSize();
  const total = components.length;

  // ── Fine-grained select cache: replay decisions for components whose
  // (component_hash, prompt_hash, cli_version) triple already has a row. Only
  // uncached components are forwarded to the LLM batches.
  const cachedResults = new Map<number, SelectOneResult>();
  let promptHash = '';
  let cliVersion = '';
  if (!cacheConfig.noCache) {
    try {
      promptHash = await hashPromptForSkill('select', skillPathOverride);
      cliVersion = await getCliCacheVersion();
      const db = openPipelineDb(cacheConfig.dbPath);
      try {
        for (let i = 0; i < components.length; i++) {
          const candidate = components[i]!;
          const compHash = computeComponentInputHash(candidate.component as RawComponentWithId);
          const hit = lookupSelectCache(db, compHash, promptHash, cliVersion);
          if (hit) {
            const finalColor = hit.decision === 'accepted' ? c.green : c.red;
            process.stderr.write(
              `  ${c.dim(`[${i + 1}/${total}]`)}  ${c.bold(candidate.component.name)}  ${finalColor(hit.decision)} ${c.dim('(cached)')}` +
                (hit.reason ? `  ${c.dim(hit.reason)}` : '') +
                '\n',
            );
            // Mirror the progress= line that selectBatch emits for live LLM
            // calls so the wizard's parser sees a uniform stream.
            const reasonEncoded = hit.reason ? encodeURIComponent(hit.reason) : '';
            process.stderr.write(
              `progress=select-agent:${i + 1}/${total}:${hit.decision}:${candidate.component.name}:${reasonEncoded}\n`,
            );
            cachedResults.set(i, {
              componentKey: componentKey(candidate.component),
              componentName: candidate.component.name,
              decision: hit.decision,
              reason: hit.reason ?? undefined,
              failed: false,
            });
          }
        }
      } finally {
        db.close();
      }
    } catch {
      // Cache prefill is best-effort. On any error, fall through and run the
      // full LLM batch path.
    }
  }

  // Build the work-set of components we still need to ask the LLM about.
  const uncached: SelectionCandidate[] = [];
  const uncachedIndices: number[] = [];
  for (let i = 0; i < components.length; i++) {
    if (!cachedResults.has(i)) {
      uncached.push(components[i]!);
      uncachedIndices.push(i);
    }
  }

  // Chunk into batches of `batchSize`, preserving original indices for the
  // per-component progress=select-agent: lines.
  const batches: BatchItem[][] = [];
  for (let i = 0; i < uncached.length; i += batchSize) {
    const slice = uncached.slice(i, i + batchSize);
    batches.push(
      slice.map((candidate, j) => ({ candidate, index: uncachedIndices[i + j]! })),
    );
  }

  process.stderr.write(
    `Validating ${c.bold(String(uncached.length))} component${uncached.length === 1 ? '' : 's'}` +
      (cachedResults.size > 0 ? c.dim(`  (${cachedResults.size} cached)`) : '') +
      c.dim(`  (concurrency: ${concurrency}, batch: ${batchSize}, batches: ${batches.length})`) +
      '\n',
  );

  const results: SelectOneResult[] = new Array(total);
  for (const [i, r] of cachedResults) results[i] = r;
  let nextBatch = 0;

  async function worker(): Promise<void> {
    while (nextBatch < batches.length) {
      const b = nextBatch++;
      const batch = batches[b]!;
      const batchResults = await selectBatch(agent, model, batch, total, verbose, skillPathOverride);
      for (let k = 0; k < batch.length; k++) {
        results[batch[k]!.index] = batchResults[k]!;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));

  // Persist fresh decisions (skip cached + failed ones).
  if (!cacheConfig.noCache && promptHash) {
    try {
      const db = openPipelineDb(cacheConfig.dbPath);
      try {
        for (let i = 0; i < results.length; i++) {
          if (cachedResults.has(i)) continue;
          const r = results[i];
          if (!r || r.failed || !r.decision) continue;
          const candidate = components[i]!;
          const compHash = computeComponentInputHash(candidate.component as RawComponentWithId);
          storeSelectCache(db, compHash, promptHash, cliVersion, r.decision, r.reason ?? null);
        }
      } finally {
        db.close();
      }
    } catch {
      // Best-effort.
    }
  }

  return results;
}

export function registerAnalyzeSelectAgentCommand(program: Command): void {
  program
    .command('select-agent')
    .description('Use an AI agent to select components for Contentful Experience Orchestration')
    .option('--session <id>', 'Session ID from analyze extract (defaults to most recent)')
    .option('--project-root <path>', 'Project root for resolving component source files')
    .option(
      '--agent <name>',
      'Agent to use: claude, codex, opencode, cursor (defaults to value saved by experiences setup)',
    )
    .option('--model <name>', 'Model to use (defaults to a small/fast model per agent)')
    .option('--verbose', 'Show full agent output including reasoning text')
    .option('--dry-run', 'Print the prompt for the first component without invoking the agent')
    .option(
      '--exclude-invalid',
      'Auto-reject components with validation errors instead of failing loud (LLM cannot fix structural issues)',
    )
    .option(
      '--select-prompt-path <path>',
      'Path to a custom .md skill prompt for select-agent (bypasses bundled prompt invariants)',
    )
    .option('--no-select-cache', 'Skip the per-component select cache and re-LLM every component')
    .option('--no-cache', 'Skip ALL fine-grained caches (extract, select, generate)')
    .option(
      '--show-rationale',
      'Read-only: print the AI rejection rationale persisted by a prior select-agent run and exit. ' +
        'No LLM call. Combine with --json for machine-readable output.',
    )
    .option('--json', 'When used with --show-rationale, emit a JSON array instead of a human-readable table')
    .action(
      async (opts: {
        session?: string;
        projectRoot?: string;
        agent?: string;
        model?: string;
        verbose?: boolean;
        dryRun?: boolean;
        excludeInvalid?: boolean;
        selectPromptPath?: string;
        selectCache?: boolean;
        cache?: boolean;
        showRationale?: boolean;
        json?: boolean;
      }) => {
        // --show-rationale is a read-only branch that short-circuits the normal
        // select-agent flow. It re-reads the rationale columns persisted by a
        // prior run (raw_components.status + reject_reason) and prints them.
        // No LLM call, no agent resolution, no validation gates.
        if (opts.showRationale) {
          try {
            runShowRationale({ session: opts.session, json: opts.json });
            return;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(`Error: ${message}\n`);
            process.exit(1);
            return;
          }
        }

        const savedCreds = await readExperiencesCredentials();
        const agentName = opts.agent ?? savedCreds.agent;
        const model = opts.model ?? savedCreds.agentModel;
        if (!agentName || !VALID_AGENTS.has(agentName)) {
          process.stderr.write(
            `Error: no agent configured. Pass --agent <name> or run experiences setup. Accepted values: claude, codex, opencode, cursor\n`,
          );
          process.exit(1);
          return;
        }

        const agent = agentName as AgentName;

        // Feature 8: validate + announce custom prompt path before any heavy
        // work. Flag wins over saved credentials.
        const selectPromptPath = opts.selectPromptPath ?? savedCreds.selectPromptPath;
        if (selectPromptPath) {
          const resolvedPath = resolve(selectPromptPath);
          const exists = await access(resolvedPath)
            .then(() => true)
            .catch(() => false);
          if (!exists) {
            process.stderr.write(`Error: custom prompt path not found: ${resolvedPath}\n`);
            process.exit(1);
            return;
          }
          if (!selectPromptPath.toLowerCase().endsWith('.md')) {
            process.stderr.write(
              `WARNING: custom prompt path does not end in .md (${selectPromptPath}) — proceeding anyway.\n`,
            );
          }
          process.stderr.write(formatCustomPromptBanner('select', resolvedPath));
        }

        const sessionId = resolveSessionId(opts.session);
        const selectionRoot = resolveProjectRoot(sessionId, opts.projectRoot);

        const db = openPipelineDb();
        let rawComponents;
        let scannedFiles: string[] = [];
        try {
          rawComponents = loadRawComponents(db, sessionId);
          scannedFiles = loadScannedFiles(db, sessionId);
        } finally {
          db.close();
        }

        if (rawComponents.length === 0) {
          process.stderr.write(`Error: session '${sessionId}' has no raw components. Run analyze extract first.\n`);
          process.exit(1);
          return;
        }

        // Re-run validation (not persisted to DB, so always recompute).
        const validatedComponents = validateExtractedComponents(rawComponents);

        // Fail-loud gate: if any component has validation errors, refuse to
        // proceed unless --exclude-invalid is set. The LLM cannot fix
        // structural issues (empty names, slot/prop collisions, etc.) — silent
        // exclusion in this CI-style command would drop components without the
        // caller noticing.
        const invalidComponents = validatedComponents.filter(shouldExcludeDueToValidation);
        if (invalidComponents.length > 0 && !opts.excludeInvalid) {
          const lines = [
            `Error: ${invalidComponents.length} component(s) failed validation; refusing select-agent without --exclude-invalid:`,
          ];
          for (const comp of invalidComponents) {
            const codes = (comp.validationIssues ?? [])
              .filter((i) => i.severity === 'error')
              .map((i) => i.code)
              .join(', ');
            lines.push(`  ✗  ${comp.name}  ${codes}`);
          }
          lines.push('');
          lines.push('Re-run with --exclude-invalid to auto-reject these components, or fix them in source first.');
          process.stderr.write(lines.join('\n') + '\n');
          process.exit(1);
          return;
        }

        const componentsForAgent = validatedComponents.filter((comp) => !shouldExcludeDueToValidation(comp));

        if (invalidComponents.length > 0) {
          process.stderr.write(c.yellow(formatExclusionWarning(invalidComponents)));
        }

        if (selectionRoot && scannedFiles.length > 0) {
          scannedFiles = scannedFiles.map((f) => (isAbsolute(f) ? f : resolve(selectionRoot, f)));
        }

        if (selectionRoot && scannedFiles.length === 0 && rawComponents.length > 0) {
          process.stderr.write(
            'warn: session has no scanned-files index (likely extracted on an older CLI version). ' +
              'Re-run `analyze extract` to enable data-fetch wrapper detection during selection.\n',
          );
        }

        let selectionCandidates: SelectionCandidate[] = componentsForAgent.map((component) => ({ component }));
        if (selectionRoot && scannedFiles.length > 0) {
          const repoIndex = await buildRepoContextIndex(selectionRoot, scannedFiles).catch(() => null);
          if (repoIndex) {
            selectionCandidates = componentsForAgent.map((component) => ({
              component,
              selectionContext: buildSelectionContext(repoIndex, component),
            }));
          }
        }

        if (opts.dryRun) {
          if (selectionCandidates.length === 0) {
            process.stderr.write(
              'No valid components to preview — all components were excluded due to validation errors.\n',
            );
            process.exit(0);
            return;
          }
          const first = selectionCandidates[0]!;
          const prompt = await buildPrompt({
            skill: 'select',
            mode: 'autonomous',
            rawComponentsInline: JSON.stringify([buildComponentData(first)], null, 2),
            outDir: process.cwd(),
            skillPathOverride: selectPromptPath ? resolve(selectPromptPath) : undefined,
          });
          process.stdout.write(prompt + '\n');
          process.exit(0);
          return;
        }

        // --no-cache is the global kill-switch; --no-select-cache is the stage-
        // specific opt-out. Both Commander negation flags arrive as `false` when
        // the user passed --no-*; default (undefined) means cache stays on.
        const noCache =
          opts.cache === false ||
          opts.selectCache === false ||
          process.env.EDS_NO_CACHE === '1';
        const selectResults = await selectAllComponents(
          agent,
          model,
          selectionCandidates,
          opts.verbose ?? false,
          selectPromptPath ? resolve(selectPromptPath) : undefined,
          { noCache },
        );

        // Build decision map from results. Seed auto-rejections from validation exclusions first.
        const decisions = new Map<string, 'accepted' | 'rejected' | null>();
        // Track per-component reasons (for raw_components.reject_reason persistence).
        // Validation auto-rejections get a synthesized "validation error: <codes>" reason
        // so the scope-gate UI can distinguish wizard- vs LLM-driven exclusions.
        const reasons = new Map<string, string | null>();
        for (const comp of invalidComponents) {
          decisions.set(componentKey(comp), 'rejected');
          const codes = (comp.validationIssues ?? [])
            .filter((i) => i.severity === 'error')
            .map((i) => i.code)
            .join(', ');
          reasons.set(componentKey(comp), `validation error: ${codes}`);
        }

        for (const r of selectResults) {
          decisions.set(r.componentKey, r.decision);
          if (r.decision === 'rejected' && r.reason) {
            reasons.set(r.componentKey, r.reason);
          } else if (r.decision === 'accepted') {
            // Defensive: clear any previously-stored reason on re-runs that flip a
            // rejected component to accepted.
            reasons.set(r.componentKey, null);
          }
        }

        // Feature 3: persist decisions to raw_components (status + reject_reason)
        // so the wizard can render LLM exclusions in the scope-gate without re-reading
        // the snapshot file. We open a fresh DB handle here (the earlier one was closed
        // after loading raw components above) and reuse it for the step-recording below.
        const persistDb = openPipelineDb();
        try {
          const updateStmt = persistDb.prepare(
            `UPDATE raw_components
             SET status = ?, reject_reason = ?
             WHERE session_id = ? AND component_id = ?`,
          );
          for (const comp of validatedComponents as Array<RawComponentDefinition & { component_id?: string }>) {
            const key = componentKey(comp);
            const decision = decisions.get(key);
            if (!decision) continue;
            if (!comp.component_id) continue;
            const reason = reasons.get(key) ?? null;
            updateStmt.run(decision, decision === 'accepted' ? null : reason, sessionId, comp.component_id);
          }
        } finally {
          persistDb.close();
        }

        const artifactsRoot = getRefineArtifactsRoot();
        let snapshot: ReviewSessionSnapshot;
        try {
          snapshot = await loadReviewInput(validatedComponents, {
            reviewRoot: selectionRoot ?? undefined,
          });
          snapshot = await ensureRefineSession(sessionId, artifactsRoot, snapshot);
        } catch (error) {
          process.stderr.write(
            `Error: unable to initialize select session.\n${error instanceof Error ? error.message : String(error)}\n`,
          );
          process.exit(1);
          return;
        }

        const paths = await getRefineSessionPaths(sessionId, artifactsRoot);

        const updated: ReviewSessionSnapshot = {
          ...snapshot,
          components: snapshot.components.map((comp) => {
            const key = componentKey(comp.originalProposal);
            const decision = decisions.get(key);
            if (!decision) return comp;
            return { ...comp, status: decision };
          }),
        };

        await saveReviewState(paths.statePath, updated);
        await Promise.all(
          updated.components
            .filter((component) => component.status === 'accepted' || component.status === 'rejected')
            .map((component) =>
              appendReviewEvent(paths.eventsPath, {
                type: 'select_agent_decision',
                payload: {
                  component: component.name,
                  source: component.originalProposal.source,
                  status: component.status,
                },
              }),
            ),
        );

        const accepted = updated.components.filter((comp) => comp.status === 'accepted');
        const rejected = updated.components.filter((comp) => comp.status === 'rejected');
        const unresolved = updated.components.filter((comp) => comp.status === 'needs-review');
        const failed = selectResults.filter((r) => r.failed);

        if (failed.length > 0) {
          process.stderr.write(c.red(`Failed (${failed.length}/${selectResults.length}):`) + '\n');
          for (const f of failed) {
            process.stderr.write(`  ${c.red('✗')}  ${f.componentName}\n`);
          }
        }

        const stepDb = openPipelineDb();
        const stepId = createStep(stepDb, sessionId, 'analyze select', {
          sessionId,
        });
        try {
          const status = failed.length === selectResults.length ? 'failed' : 'complete';
          updateStep(stepDb, stepId, status, { sessionId });
        } finally {
          stepDb.close();
        }

        process.stderr.write(
          `Accepted: ${accepted.length}  Rejected: ${rejected.length}  Needs review: ${unresolved.length}\n`,
        );
      },
    );
}
