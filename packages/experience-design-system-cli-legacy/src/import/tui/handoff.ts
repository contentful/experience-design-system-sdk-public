import { HANDOFF_ENV, parseHandoff, type ImportHandoff } from '@contentful/experience-design-system-types/handoff';

// The legacy wizard no longer runs the early stages of the import itself. The CLI does, and tells the wizard what it did
// in one environment variable (see the types package, `handoff`). This file turns that into the wizard's starting state.
// It only seeds data. Where the wizard goes next is decided by its own routing, as if it had done the work itself.
// Delete this file when the wizard is deleted.

/** The wizard state the early stages produce. Every field is one the stage used to write. */
export interface HandoffState {
  credentialsSkipped: boolean;
  tokensPath?: string;
  tokenSessionId?: string | null;
  tokenCount?: number;
  tokenGenerationStatus?: 'complete';
  outDir?: string;
  extractSessionId?: string;
  compositionPhase?: 'done' | 'cache-hit';
  selectionAgentStatus?: 'complete';
  existingEntitiesStatus?: 'idle' | 'complete' | 'failed';
  existingEntitiesPath?: string | null;
  acceptedCount?: number;
  autoRejectedCount?: number;
  generateSessionId?: string;
  generatedCount?: number;
  mapTokensEligible?: boolean;
  mapTokensStatus?: 'complete';
}

/** Where the wizard goes first: the review screen with the generated definitions, or straight to saving and pushing. */
export type StartRoute = 'review' | 'push';

export function routeFromHandoff(handoff: ImportHandoff): StartRoute | null {
  return handoff.generation?.route ?? null;
}

export function stateFromHandoff(handoff: ImportHandoff): HandoffState {
  const { extraction, generation } = handoff;
  return {
    credentialsSkipped: handoff.credentialsSkipped,
    ...(extraction
      ? {
          tokensPath: extraction.tokensPath,
          tokenSessionId: extraction.tokenSessionId,
          tokenCount: extraction.tokenCount,
          tokenGenerationStatus: 'complete' as const,
          outDir: extraction.outDir,
          extractSessionId: extraction.sessionId,
          compositionPhase: extraction.compositionPhase,
          selectionAgentStatus: 'complete' as const,
          existingEntitiesStatus: extraction.existingEntitiesStatus,
          existingEntitiesPath: extraction.existingEntitiesPath,
        }
      : {}),
    ...(generation?.route === 'review'
      ? {
          acceptedCount: generation.acceptedCount,
          autoRejectedCount: 0,
          generateSessionId: generation.sessionId,
          generatedCount: generation.generatedCount,
          mapTokensEligible: generation.mapTokensEligible,
          mapTokensStatus: 'complete' as const,
        }
      : generation?.route === 'push'
        ? { acceptedCount: 0, autoRejectedCount: 0 }
        : {}),
  };
}

export type StartFromHandoff =
  | {
      ok: true;
      handoff: ImportHandoff;
      state: HandoffState;
      route: StartRoute | null;
    }
  | { ok: false; error: string };

/** Reads the handoff the CLI passed. A missing or broken one is an error to show, never a guess at a start. */
export function readHandoff(env: NodeJS.ProcessEnv = process.env): StartFromHandoff {
  const parsed = parseHandoff(env[HANDOFF_ENV]);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    handoff: parsed.handoff,
    state: stateFromHandoff(parsed.handoff),
    route: routeFromHandoff(parsed.handoff),
  };
}
