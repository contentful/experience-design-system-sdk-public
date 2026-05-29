import type { Command } from 'commander';
import { openPipelineDb, loadRawComponents, createStep, updateStep } from '../../session/db.js';
import {
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
  componentName: string;
  decision: 'accepted' | 'rejected' | null;
  reason?: string;
  failed: boolean;
  error?: string;
}

function buildComponentData(component: RawComponentDefinition) {
  return {
    name: component.name,
    source: component.source,
    framework: component.framework,
    propCount: component.props.length,
    slotCount: component.slots.length,
    propNames: component.props.slice(0, 8).map((p) => p.name),
    props: component.props,
    slots: component.slots,
  };
}

async function selectOneComponent(
  agent: AgentName,
  model: string | undefined,
  component: RawComponentDefinition,
  index: number,
  total: number,
  verbose: boolean,
): Promise<SelectOneResult> {
  const prompt = await buildPrompt({
    skill: 'select',
    mode: 'autonomous',
    rawComponentsInline: JSON.stringify([buildComponentData(component)], null, 2),
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

  process.stderr.write(`  ${pos}  ${c.bold(component.name)}\n${outputBuf}`);

  if (result.timedOut) {
    return { componentName: component.name, decision: null, failed: true, error: 'timed out' };
  }

  if (result.exitCode !== 0) {
    return {
      componentName: component.name,
      decision: null,
      failed: true,
      error: `agent exited with code ${result.exitCode}`,
    };
  }

  const { calls, warnings } = parseSelectToolCallLines(result.stdout);

  if (warnings.length > 0) {
    for (const w of warnings) process.stderr.write(`  ${c.yellow('⚠')}  ${component.name}: ${w}\n`);
  }

  const call = calls.find((call): call is SelectToolCall => call.name === component.name) ?? calls[0];

  if (!call) {
    return {
      componentName: component.name,
      decision: null,
      failed: true,
      error: 'agent produced no tool call for this component',
    };
  }

  const decision = call.tool === 'select_component' ? 'accepted' : 'rejected';
  return { componentName: component.name, decision, reason: call.reason, failed: false };
}

async function selectAllComponents(
  agent: AgentName,
  model: string | undefined,
  components: RawComponentDefinition[],
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

        if (opts.dryRun) {
          const first = rawComponents[0]!;
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

        const selectResults = await selectAllComponents(agent, opts.model, rawComponents, opts.verbose ?? false);

        // Build decision map from results
        const decisions = new Map<string, 'accepted' | 'rejected'>();
        for (const r of selectResults) {
          if (!r.failed && r.decision) {
            decisions.set(r.componentName, r.decision);
          }
        }

        // Load existing snapshot and apply decisions
        const artifactsRoot = getRefineArtifactsRoot();
        let snapshot: ReviewSessionSnapshot;
        try {
          snapshot = await loadReviewInput(rawComponents, {
            reviewRoot: opts.projectRoot,
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
            const decision = decisions.get(comp.name);
            if (!decision) return comp;
            return { ...comp, status: decision };
          }),
        };

        await saveReviewState(paths.statePath, updated);

        const accepted = updated.components.filter((comp) => comp.status === 'accepted');
        const rejected = updated.components.filter((comp) => comp.status === 'rejected');
        const failed = selectResults.filter((r) => r.failed);

        if (failed.length > 0) {
          process.stderr.write(c.red(`Failed (${failed.length}/${selectResults.length}):`) + '\n');
          for (const f of failed) {
            process.stderr.write(`  ${c.red('✗')}  ${f.componentName}  ${c.dim(f.error ?? 'unknown error')}\n`);
          }
        }

        // Write step to DB
        const stepDb = openPipelineDb();
        const stepId = createStep(stepDb, sessionId, 'analyze select', { sessionId });
        try {
          const status = failed.length === selectResults.length ? 'failed' : 'complete';
          updateStep(stepDb, stepId, status, { sessionId });
        } finally {
          stepDb.close();
        }

        process.stderr.write(`Accepted: ${accepted.length}  Rejected: ${rejected.length}\n`);
      },
    );
}
