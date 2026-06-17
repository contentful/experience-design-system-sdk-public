import type { Command } from 'commander';
import { openPipelineDb, loadRawComponents, loadScannedFiles, createStep, updateStep } from '../../session/db.js';
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
import { parseSelectToolCallLines, runAgent } from '../../generate/agent-runner.js';
import type { AgentName, SelectToolCall } from '../../generate/agent-runner.js';
import type { RawComponentDefinition } from '../../types.js';
import { readExperiencesCredentials } from '../../credentials-store.js';
import { OutputFormatter, c } from '../../output/format.js';
import { buildRepoContextIndex, buildSelectionContext, type SelectionContext } from './context-builder.js';
import { isAbsolute, resolve } from 'node:path';
import {
  validateExtractedComponents,
  shouldExcludeDueToValidation,
  formatExclusionWarning,
} from '../extract/validate.js';

const VALID_AGENTS = new Set<string>(['claude', 'codex', 'opencode', 'cursor']);
const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 3 * 60 * 1000);
const DEFAULT_CONCURRENCY = 5;

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

async function selectOneComponent(
  agent: AgentName,
  model: string | undefined,
  candidate: SelectionCandidate,
  index: number,
  total: number,
  verbose: boolean,
): Promise<SelectOneResult> {
  const { component } = candidate;
  const prompt = await buildPrompt({
    skill: 'select',
    mode: 'autonomous',
    rawComponentsInline: JSON.stringify([buildComponentData(candidate)], null, 2),
    outDir: process.cwd(),
  });

  const pos = c.dim(`[${index + 1}/${total}]`);
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
    process.stderr.write(`  ${pos}  ${c.bold(component.name)}\n${outputBuf}`);
  }

  if (result.timedOut) {
    process.stderr.write(`  ${pos}  ${c.bold(component.name)}  ${c.yellow('timed out')}\n`);
    return {
      componentKey: componentKey(component),
      componentName: component.name,
      decision: null,
      failed: true,
    };
  }

  if (result.exitCode !== 0) {
    process.stderr.write(
      `  ${pos}  ${c.bold(component.name)}  ${c.red(`agent exited with code ${result.exitCode}`)}\n`,
    );
    const errText = result.stderr.trim();
    if (errText) {
      process.stderr.write(`${errText}\n`);
    }
    return {
      componentKey: componentKey(component),
      componentName: component.name,
      decision: null,
      failed: true,
    };
  }

  const { calls, warnings } = parseSelectToolCallLines(result.stdout);

  if (warnings.length > 0) {
    for (const warning of warnings) {
      process.stderr.write(`  ${c.yellow('⚠')}  ${component.name}: ${warning}\n`);
    }
  }

  const call = calls.find((toolCall): toolCall is SelectToolCall => toolCall.name === component.name) ?? calls[0];
  if (!call) {
    process.stderr.write(`  ${pos}  ${c.bold(component.name)}  ${c.yellow('no tool call')}\n`);
    return {
      componentKey: componentKey(component),
      componentName: component.name,
      decision: null,
      failed: true,
    };
  }

  const decision = call.tool === 'select_component' ? 'accepted' : 'rejected';
  const finalColor = decision === 'accepted' ? c.green : c.red;
  process.stderr.write(
    `  ${pos}  ${c.bold(component.name)}  ${finalColor(decision)}${call.reason ? `  ${c.dim(call.reason)}` : ''}\n`,
  );

  return {
    componentKey: componentKey(component),
    componentName: component.name,
    decision,
    reason: call.reason,
    failed: false,
  };
}

async function selectAllComponents(
  agent: AgentName,
  model: string | undefined,
  components: SelectionCandidate[],
  verbose: boolean,
): Promise<SelectOneResult[]> {
  const concurrency = Number(process.env.EDS_GENERATE_CONCURRENCY ?? DEFAULT_CONCURRENCY);
  process.stderr.write(
    `Validating ${c.bold(String(components.length))} component${components.length === 1 ? '' : 's'}` +
      c.dim(`  (concurrency: ${concurrency})`) +
      '\n',
  );

  const results: SelectOneResult[] = new Array(components.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < components.length) {
      const i = next++;
      results[i] = await selectOneComponent(agent, model, components[i]!, i, components.length, verbose);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, components.length) }, worker));
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
    .action(
      async (opts: {
        session?: string;
        projectRoot?: string;
        agent?: string;
        model?: string;
        verbose?: boolean;
        dryRun?: boolean;
        excludeInvalid?: boolean;
      }) => {
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
          });
          process.stdout.write(prompt + '\n');
          process.exit(0);
          return;
        }

        const selectResults = await selectAllComponents(agent, model, selectionCandidates, opts.verbose ?? false);

        // Build decision map from results. Seed auto-rejections from validation exclusions first.
        const decisions = new Map<string, 'accepted' | 'rejected' | null>();
        for (const comp of invalidComponents) {
          decisions.set(componentKey(comp), 'rejected');
        }

        for (const r of selectResults) {
          decisions.set(r.componentKey, r.decision);
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
