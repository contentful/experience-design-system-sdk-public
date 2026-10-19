import {
  applyScopeDecisions,
  openPipelineDb,
  writeScopeDecisionsSnapshot,
} from '@contentful/experience-design-system-backend-pipeline';
import type { GenerationInput } from './types.js';
import { throwIfAborted } from '../../cancellation.js';

/**
 * Applies the scope decisions to the session and writes the review snapshot that `generate components` reads to leave
 * out rejected components. Without the snapshot the generator would process rejected components anyway.
 * Uses `applyScopeDecisions` and `writeScopeDecisionsSnapshot` from backend-pipeline, which are identical to legacy's.
 * Both write to the pipeline database, so this runs only after the cache check has finished restoring into it.
 */
export async function saveDecisions(input: Pick<GenerationInput, 'sessionId' | 'decisions' | 'signal'>): Promise<void> {
  throwIfAborted(input.signal);
  const db = openPipelineDb();
  try {
    throwIfAborted(input.signal);
    applyScopeDecisions(db, input.sessionId, input.decisions);
    throwIfAborted(input.signal);
    await writeScopeDecisionsSnapshot(db, input.sessionId, input.decisions);
    throwIfAborted(input.signal);
  } finally {
    db.close();
  }
}
