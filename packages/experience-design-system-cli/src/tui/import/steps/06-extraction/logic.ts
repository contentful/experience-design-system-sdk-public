import type { RunningLine } from '../../shared/running-step/logic.js';
import { parseAgentModel, resolveAgent, resolveModel } from '@contentful/experience-design-system-backend-pipeline';
import type { ExtractAndComposeProgress } from '@contentful/experience-design-system-backend-pipeline';
import type { ExtractionProgress } from './types.js';
import { describeAgentActivity } from '../../shared/agent-activity.js';

/** Structured progress events emitted by the orchestrator (extraction + composition). */
export type ProgressEvent = ExtractAndComposeProgress;

/**
 * Every job the stage will run starts on the first frame, so no row appears later as a surprise. A job that does not
 * apply stays 'idle' and has no row: existing entities need credentials, and token definitions need a raw tokens file.
 */
export function initialProgress(input: { hasCredentials: boolean; hasRawTokens: boolean }): ExtractionProgress {
  return {
    scan: null,
    composition: 'resolving',
    selection: 'running',
    existingEntities: input.hasCredentials ? 'running' : 'idle',
    tokens: input.hasRawTokens ? 'running' : 'idle',
  };
}

export function applyProgressEvent(progress: ExtractionProgress, event: ProgressEvent): ExtractionProgress {
  switch (event.kind) {
    case 'extract':
      return {
        ...progress,
        scan: { scanned: event.done, total: event.total, componentsFound: event.componentsSoFar },
        sourceActivity: { phase: 'analyzing', activity: event.activity ?? 'Reading component definitions…' },
      };
    case 'source':
      return { ...progress, sourceActivity: { phase: event.phase, activity: event.activity } };
    case 'composition':
      return { ...progress, composition: event.phase, compositionActivity: event.activity };
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function compositionDone(progress: ExtractionProgress): boolean {
  return progress.composition === 'done' || progress.composition === 'cache-hit';
}

function explorationRow(progress: ExtractionProgress, agent: string): RunningLine {
  const event = progress.exploration;
  if (!event)
    return {
      id: 'exploration',
      text:
        progress.selection === 'complete'
          ? 'Component exploration complete'
          : progress.sourceActivity?.phase === 'complete' && progress.existingEntities === 'running'
            ? 'Component exploration waiting for existing entities…'
            : 'Component exploration waiting for source evidence...',
      complete: progress.selection === 'complete',
      ...(progress.selection !== 'complete' ? { pending: true } : {}),
    };
  const labels: Record<typeof event.stage, string> = {
    loading: 'Reading and validating extracted component evidence...',
    preparing: 'Preparing component exploration...',
    cached: `Component exploration reused from cache${event.scope ? ` — ${event.scope}` : ''}`,
    exploring: `Exploring components via ${agent}${event.scope ? ` — ${event.scope}` : ''}`,
    checking: 'Checking component exploration evidence...',
    reconciling: 'Reconciling exploration results...',
    verifying: 'Verifying exploration findings...',
    finalizing: 'Saving component exploration results...',
    complete: 'Component exploration complete',
  };
  return {
    id: 'exploration',
    text: labels[event.stage],
    detail: describeAgentActivity(event.invocation),
    complete: event.stage === 'complete',
    ...(['exploring', 'cached', 'complete'].includes(event.stage)
      ? { progress: { done: event.done, total: event.total, label: 'explorer passes complete' } }
      : {}),
  };
}

/** The rows the screen shows, in the order the wizard showed them. Rows that do not apply are left out. */
export function progressRows(progress: ExtractionProgress, agent: string): RunningLine[] {
  const { scan, composition, existingEntities, tokens } = progress;
  const scanned = scan?.scanned ?? 0;
  const total = scan?.total ?? 0;
  const scanComplete = progress.sourceActivity
    ? progress.sourceActivity.phase === 'complete'
    : total > 0 && scanned >= total;
  const compositionPending = composition === 'resolving' && !progress.compositionActivity;
  const sourceLabels = {
    analyzing: 'Analyzing source files…',
    validating: 'Validating extracted components…',
    capturing: 'Capturing source evidence…',
    captured: 'Source files captured; awaiting relationship evidence…',
    publishing: 'Saving source analysis…',
    complete: `Analyzed ${plural(scanned, 'source file')}`,
  };

  const rows: RunningLine[] = [
    {
      id: 'source-analysis',
      text: progress.sourceActivity
        ? sourceLabels[progress.sourceActivity.phase]
        : scan === null
          ? 'Analyzing source files...'
          : scanComplete
            ? `Analyzed ${plural(scanned, 'source file')}`
            : scan.total === null
              ? `Analyzing ${plural(scanned, 'source file')}...`
              : `Analyzing source files — ${scanned}/${scan.total}`,
      complete: scanComplete,
      pending: progress.sourceActivity?.phase === 'captured',
      detail:
        [
          progress.sourceActivity?.activity,
          scan?.componentsFound === undefined ? undefined : `${plural(scan.componentsFound, 'component')} found`,
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
      ...(scan &&
      total > 0 &&
      (!progress.sourceActivity || progress.sourceActivity.phase === 'analyzing' || scanComplete)
        ? { progress: { done: scanned, total, label: 'source files considered' } }
        : {}),
    },
    {
      id: 'relationships',
      text:
        composition === 'cache-hit'
          ? 'Component relationships (cached)'
          : compositionDone(progress)
            ? 'Component relationships collected'
            : compositionPending
              ? 'Source relationship evidence waiting for analysis…'
              : 'Collecting source relationship evidence…',
      complete: compositionDone(progress),
      detail: progress.compositionActivity,
      ...(compositionPending ? { pending: true } : {}),
    },
    explorationRow(progress, agent),
  ];

  if (existingEntities !== 'idle') {
    rows.push({
      id: 'existing-entities',
      text:
        existingEntities === 'running'
          ? 'Fetching existing components and tokens...'
          : existingEntities === 'complete'
            ? 'Existing components and tokens ready'
            : 'Existing entities unavailable; continuing without them',
      complete: existingEntities !== 'running',
      failed: existingEntities === 'failed',
      detail: existingEntities === 'running' ? progress.existingEntitiesActivity : undefined,
    });
  }

  if (tokens !== 'idle') {
    rows.push({
      id: 'tokens',
      text:
        tokens === 'complete'
          ? 'Token definitions ready'
          : tokens === 'failed'
            ? 'Token definition generation failed'
            : `Generating token definitions via ${agent}...`,
      complete: tokens === 'complete',
      failed: tokens === 'failed',
      detail:
        tokens === 'complete' && progress.tokenCount !== undefined
          ? `${plural(progress.tokenCount, 'token')} generated`
          : tokens === 'running'
            ? tokenActivityLabel(progress.tokenActivity?.kind)
            : undefined,
    });
  }

  return rows;
}

function tokenActivityLabel(kind?: NonNullable<ExtractionProgress['tokenActivity']>['kind']): string {
  if (kind === 'writing-file') return 'Writing token definitions…';
  if (kind === 'cache-hit') return 'Loading previously generated token definitions…';
  if (kind?.startsWith('agent:')) return 'Agent is analyzing token values and generating definitions…';
  if (kind === 'done') return 'Token definitions saved';
  return 'Reading token source and preparing generation…';
}

/** True when every job is already done, so the screen would only flash. The wizard shows nothing in this case. */
export function isFullCacheHit(progress: ExtractionProgress): boolean {
  return (
    (progress.scan?.total ?? 0) > 0 &&
    compositionDone(progress) &&
    progress.selection === 'complete' &&
    (progress.tokens === 'idle' || progress.tokens === 'complete') &&
    progress.existingEntities !== 'running'
  );
}

export function noComponentsMessage(projectPath: string): string {
  return `No components found in ${projectPath}.\n\nMake sure this path contains TypeScript/React/Vue component files (.tsx, .ts, .vue, etc.).`;
}

export function agentAuthMessage(agent: string, status: 'not-found' | 'unauthenticated'): string {
  if (status === 'not-found') {
    return `The \`${agent}\` CLI was not found on your PATH.\n\nInstall it, then re-run \`experiences import\`.`;
  }
  return (
    `${agent} is not authenticated.\n\n` +
    `Run \`${agent}\` in your terminal to log in, then re-run \`experiences import\`.\n\n` +
    'If you are using AWS Bedrock, run:\n' +
    '  aws sso login --profile <your-profile>'
  );
}

/**
 * The agent and model the import runs with: what was typed after `--agent` (either `agent` or `agent:model`), else
 * what `experiences setup` saved, else Claude with no model. Same chain the legacy import command uses.
 */
export function resolveAgentChoice(
  flag: string | undefined,
  stored: { agent?: unknown; agentModel?: unknown },
): { agent: string; agentModel?: string } {
  const parsed = parseAgentModel(flag);
  const agent = resolveAgent(parsed.agent, typeof stored.agent === 'string' ? stored.agent : undefined);
  const agentModel = resolveModel(parsed.model, typeof stored.agentModel === 'string' ? stored.agentModel : undefined);
  return { agent, ...(agentModel ? { agentModel } : {}) };
}
