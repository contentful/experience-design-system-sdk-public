import { resolve } from 'node:path';
import type { ReviewSessionPaths } from '../types/review-session.js';

export async function getRefineSessionPaths(sessionId: string, artifactsRoot: string): Promise<ReviewSessionPaths> {
  const sessionDir = resolve(artifactsRoot, sessionId);
  return {
    sessionDir,
    eventsPath: resolve(sessionDir, 'events.jsonl'),
    statePath: resolve(sessionDir, 'current-review-state.json'),
  };
}
