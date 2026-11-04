import {
  applyScopeDecisions,
  openPipelineDb,
  writeScopeDecisionsSnapshot,
} from '@contentful/experience-design-system-backend-pipeline';
import type { GenerationInput } from './types.js';
import { throwIfAborted } from '../../cancellation.js';

/**
 * Saves human scope decisions in the database. Completed exploration consumes that scope directly;
 * the snapshot writer only creates a review artifact for legacy sessions without exploration.
 */
export async function saveDecisions(input: Pick<GenerationInput, 'sessionId' | 'decisions' | 'signal'>): Promise<void> {
  throwIfAborted(input.signal);
  const db = openPipelineDb();
  try {
    throwIfAborted(input.signal);
    applyScopeDecisions(db, input.sessionId, input.decisions);
    throwIfAborted(input.signal);
    await writeScopeDecisionsSnapshot(db, input.sessionId);
    throwIfAborted(input.signal);
  } finally {
    db.close();
  }
}
