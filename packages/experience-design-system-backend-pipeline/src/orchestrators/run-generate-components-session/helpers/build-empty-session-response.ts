import type { RunGenerateComponentsSessionResponse } from '../types.js';

/** Response shape when the session has no raw components to generate from. */
export function buildEmptySessionResponse(sessionId: string): RunGenerateComponentsSessionResponse {
  return {
    sessionId,
    results: [],
    allOk: true,
    renamedSlotsCount: 0,
    duplicateNames: [],
    droppedAllowedComponents: [],
    emptySession: true,
  };
}
