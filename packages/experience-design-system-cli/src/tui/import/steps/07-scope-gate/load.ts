import {
  loadScopeComponents,
  loadScopeDecisions,
  openPipelineDb,
} from '@contentful/experience-design-system-backend-pipeline';
import type { ScopeGateLoad } from './types.js';

/**
 * Reads the components for the gate, once, before the screen renders. Replaces legacy's database read inside render
 * (and its "remember the last list" workaround for the resize that happened after confirming): with nothing written
 * until the wizard saves the decisions, the list cannot change under the screen.
 * Uses `loadScopeComponents` from backend-pipeline, which is identical to legacy's.
 */
export function loadScopeGate(sessionId: string): ScopeGateLoad {
  try {
    const db = openPipelineDb();
    try {
      const components = loadScopeComponents(db, sessionId);
      if (components.length === 0) {
        return { ok: false, message: 'No components found for this session. Please run the import again.' };
      }
      const savedDecisions = loadScopeDecisions(db, sessionId);
      return { ok: true, components, ...(savedDecisions ? { savedDecisions } : {}) };
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      ok: false,
      message: `Could not read the extracted components: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
