import type { RunGenerateComponentsSessionResponse } from '../types.js';

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
