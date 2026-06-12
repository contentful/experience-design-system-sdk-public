import type { Command } from 'commander';
import { openPipelineDb, loadRawComponents, createStep, updateStep } from '../../session/db.js';
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
import { OutputFormatter, c } from '../../output/format.js';
import {
  DEFAULT_REVIEW_VOTE_COUNT,
  type SelectionAudit,
  type SelectionDecision,
  type SelectionVote,
  summarizeSelectionVotes,
} from './consensus.js';
import {
  buildRepoContextIndex,
  buildSelectionContext,
  summarizeSelectionContext,
  type SelectionContext,
} from './context-builder.js';
import { resolve } from 'node:path';

const VALID_AGENTS = new Set<string>(['claude', 'codex', 'opencode', 'cursor']);
const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 3 * 60 * 1000);
const DEFAULT_CONCURRENCY = 5;
const REVIEW_VOTE_COUNT = Math.max(1, Number(process.env.EDS_SELECT_VOTE_COUNT ?? DEFAULT_REVIEW_VOTE_COUNT));
const SINGLE_PASS_VOTE_COUNT = 1;

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
  decision: SelectionDecision;
  audit: SelectionAudit;
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

function getSelectionVoteCount(component: RawComponentDefinition): number {
  if (component.needsReview === true) {
    return REVIEW_VOTE_COUNT;
  }

  if (typeof component.extractionConfidence === 'number' && component.extractionConfidence <= 3) {
    return REVIEW_VOTE_COUNT;
  }

  return SINGLE_PASS_VOTE_COUNT;
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
  const { component, selectionContext } = candidate;
  const voteCount = getSelectionVoteCount(component);
  const prompt = await buildPrompt({
    skill: 'select',
    mode: 'autonomous',
    rawComponentsInline: JSON.stringify([buildComponentData(candidate)], null, 2),
    outDir: process.cwd(),
  });

  const pos = c.dim(`[${index + 1}/${total}]`);
  const votes: SelectionVote[] = [];
  const contextSummary = summarizeSelectionContext(selectionContext);

  for (let attempt = 1; attempt <= voteCount; attempt++) {
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
      process.stderr.write(
        `  ${pos}  ${c.bold(component.name)}  ${c.dim(`vote ${attempt}/${voteCount}`)}\n${outputBuf}`,
      );
    }

    if (result.timedOut) {
      votes.push({ attempt, decision: null, error: 'timed out' });
      continue;
    }

    if (result.exitCode !== 0) {
      votes.push({
        attempt,
        decision: null,
        error: `agent exited with code ${result.exitCode}`,
      });
      continue;
    }

    const { calls, warnings } = parseSelectToolCallLines(result.stdout);

    if (warnings.length > 0) {
      for (const warning of warnings) {
        process.stderr.write(`  ${c.yellow('⚠')}  ${component.name}: ${warning}\n`);
      }
    }

    const call = calls.find((toolCall): toolCall is SelectToolCall => toolCall.name === component.name) ?? calls[0];
    if (!call) {
      votes.push({
        attempt,
        decision: null,
        error: 'agent produced no tool call for this component',
      });
      continue;
    }

    votes.push({
      attempt,
      decision: call.tool === 'select_component' ? 'accepted' : 'rejected',
      reason: call.reason,
      confidence: call.confidence,
    });
  }

  const consensus = summarizeSelectionVotes(votes, contextSummary);
  const finalColor = consensus.decision === 'accepted' ? c.green : consensus.decision === 'rejected' ? c.red : c.yellow;
  const finalLabel =
    consensus.decision === 'accepted' ? 'accepted' : consensus.decision === 'rejected' ? 'rejected' : 'needs review';
  const detail = consensus.audit.winningReason;
  process.stderr.write(
    `  ${pos}  ${c.bold(component.name)}  ${finalColor(finalLabel)}${detail ? `  ${c.dim(detail)}` : ''}\n`,
  );

  return {
    componentKey: componentKey(component),
    componentName: component.name,
    decision: consensus.decision,
    audit: consensus.audit,
    reason: consensus.audit.winningReason,
    failed: consensus.failed,
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
    .requiredOption('--agent <name>', 'Agent to use: claude, codex, opencode, cursor')
    .option('--model <name>', 'Model to use (defaults to a small/fast model per agent)')
    .option('--verbose', 'Show full agent output including reasoning text')
    .option('--dry-run', 'Print the prompt for the first component without invoking the agent')
    .action(
      async (opts: {
        session?: string;
        projectRoot?: string;
        agent: string;
        model?: string;
        verbose?: boolean;
        dryRun?: boolean;
      }) => {
        if (!VALID_AGENTS.has(opts.agent)) {
          process.stderr.write(
            `Error: unknown agent '${opts.agent}'. Accepted values: claude, codex, opencode, cursor\n`,
          );
          process.exit(1);
          return;
        }

        const agent = opts.agent as AgentName;
        const sessionId = resolveSessionId(opts.session);
        const selectionRoot = resolveProjectRoot(sessionId, opts.projectRoot);

        const db = openPipelineDb();
        let rawComponents;
        try {
          rawComponents = loadRawComponents(db, sessionId);
        } finally {
          db.close();
        }

        if (rawComponents.length === 0) {
          process.stderr.write(`Error: session '${sessionId}' has no raw components. Run analyze extract first.\n`);
          process.exit(1);
          return;
        }

        let selectionCandidates: SelectionCandidate[] = rawComponents.map((component) => ({ component }));
        if (selectionRoot) {
          const repoIndex = await buildRepoContextIndex(selectionRoot).catch(() => null);
          if (repoIndex) {
            selectionCandidates = rawComponents.map((component) => ({
              component,
              selectionContext: buildSelectionContext(repoIndex, component),
            }));
          }
        }

        if (opts.dryRun) {
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

        const selectResults = await selectAllComponents(agent, opts.model, selectionCandidates, opts.verbose ?? false);

        // Build decision map from results
        const decisions = new Map<string, SelectionDecision>();
        const audits = new Map<string, SelectionAudit>();
        for (const r of selectResults) {
          decisions.set(r.componentKey, r.decision);
          audits.set(r.componentKey, r.audit);
        }

        // Load existing snapshot and apply decisions
        const artifactsRoot = getRefineArtifactsRoot();
        let snapshot: ReviewSessionSnapshot;
        try {
          snapshot = await loadReviewInput(rawComponents, {
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
            const selectionAudit = audits.get(key);
            if (!decision) return comp;
            const status = decision === 'needs-review' ? 'needs-review' : decision;
            return { ...comp, status, selectionAudit };
          }),
        };

        await saveReviewState(paths.statePath, updated);
        await Promise.all(
          updated.components
            .filter((component) => component.selectionAudit)
            .map((component) =>
              appendReviewEvent(paths.eventsPath, {
                type: 'select_agent_decision',
                payload: {
                  component: component.name,
                  source: component.originalProposal.source,
                  status: component.status,
                  selectionAudit: component.selectionAudit,
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
            process.stderr.write(`  ${c.red('✗')}  ${f.componentName}  ${c.dim('all votes failed')}\n`);
          }
        }

        // Write step to DB
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
