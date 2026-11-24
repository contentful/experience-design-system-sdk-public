import { applyScopeDecisions, openPipelineDb } from '../../../persistence/src/index.js';
import type { ImportGenerationInput as GenerationInput } from '../types.js';

/**
 * Applies the scope decisions to the session's components. This writes to the pipeline database, so it runs only after
 * the cache check has finished restoring into it.
 */
export async function saveDecisions(input: Pick<GenerationInput, 'sessionId' | 'decisions'>): Promise<void> {
  const db = openPipelineDb();
  try {
    applyScopeDecisions(db, input.sessionId, input.decisions);
  } finally {
    db.close();
  }
}
