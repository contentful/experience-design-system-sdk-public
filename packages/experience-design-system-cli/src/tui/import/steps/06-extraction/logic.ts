import { parseAgentModel, resolveAgent, resolveModel } from '@contentful/experience-design-system-backend-pipeline';
import type { ExtractAndComposeProgress } from '@contentful/experience-design-system-backend-pipeline';
import type { ExtractionProgress } from './types.js';

/** Structured progress events emitted by the orchestrator (extraction + composition). */
export type ProgressEvent = ExtractAndComposeProgress;

/**
 * Every job the stage will run starts on the first frame, so no row appears later as a surprise. A job that does not
 * apply stays 'idle' and has no row: existing entities need credentials, token definitions need a raw tokens file, and
 * reused tokens are already complete.
 */
export function initialProgress(input: {
  hasCredentials: boolean;
  hasRawTokens: boolean;
  reuseTokens: boolean;
}): ExtractionProgress {
  return {
    scan: null,
    composition: 'resolving',
    selection: 'running',
    existingEntities: input.hasCredentials ? 'running' : 'idle',
    tokens: input.hasRawTokens ? (input.reuseTokens ? 'complete' : 'running') : 'idle',
  };
}

export function applyProgressEvent(progress: ExtractionProgress, event: ProgressEvent): ExtractionProgress {
  switch (event.kind) {
    case 'extract':
      return { ...progress, scan: { scanned: event.done, total: event.total } };
    case 'composition':
      return { ...progress, composition: event.phase };
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function compositionDone(progress: ExtractionProgress): boolean {
  return progress.composition === 'done' || progress.composition === 'cache-hit';
}

/** The rows the screen shows, in the order the wizard showed them. Rows that do not apply are left out. */
export function progressRows(progress: ExtractionProgress, agent: string): Array<{ text: string; complete: boolean }> {
  const { scan, composition, selection, existingEntities, tokens } = progress;
  const scanned = scan?.scanned ?? 0;
  const scanComplete = (scan?.total ?? 0) > 0;

  const rows: Array<{ text: string; complete: boolean }> = [
    {
      text: scan === null ? 'Scanning files...' : `${scanComplete ? 'Scanned' : 'Scanning'} ${plural(scanned, 'file')}`,
      complete: scanComplete,
    },
    {
      text:
        composition === 'cache-hit'
          ? 'Composition mapping (cached)'
          : compositionDone(progress)
            ? 'Composition mapping complete'
            : `Mapping composition via ${composition.startsWith('agent:') ? composition.slice('agent:'.length) : agent}...`,
      complete: compositionDone(progress),
    },
    {
      text: selection === 'complete' ? 'Selection agent complete' : `Filtering component selection via ${agent}...`,
      complete: selection === 'complete',
    },
  ];

  if (existingEntities !== 'idle') {
    rows.push({
      text:
        existingEntities === 'running'
          ? 'Fetching existing components and tokens...'
          : existingEntities === 'complete'
            ? 'Existing components and tokens ready'
            : 'Existing entities unavailable; continuing without them',
      complete: existingEntities !== 'running',
    });
  }

  if (tokens !== 'idle') {
    rows.push({
      text:
        tokens === 'complete'
          ? 'Token definitions ready'
          : tokens === 'failed'
            ? 'Token definition generation failed'
            : `Generating token definitions via ${agent}...`,
      complete: tokens === 'complete',
    });
  }

  return rows;
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

/**
 * The wizard's step counts: three fixed steps, one more when there is a token stage, two more when components are
 * imported, and one more when the tokens can be mapped (not known yet at this stage, so it adds nothing here).
 * Extraction is step 2 when there is a token stage, otherwise step 1.
 */
export function stepNumbers(input: {
  hasRawTokens: boolean;
  skipComponents?: boolean;
  mapTokensEligible?: boolean | null;
}): {
  stepNumber: number;
  totalSteps: number;
} {
  const { hasRawTokens, skipComponents = false, mapTokensEligible = null } = input;
  return {
    stepNumber: hasRawTokens ? 2 : 1,
    totalSteps: 3 + (hasRawTokens ? 1 : 0) + (skipComponents ? 0 : 2) + (mapTokensEligible === true ? 1 : 0),
  };
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
