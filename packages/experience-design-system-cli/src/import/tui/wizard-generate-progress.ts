/**
 * Pure parser for the generate-step stderr stream.
 *
 * Two line shapes can carry progress info:
 *
 * 1. `progress=generate:<done>/<total>:<name>` — emitted at terminal completion
 *    of each component in `runAllComponents`. `done` is the count of completed
 *    components and is monotonically non-decreasing.
 * 2. `[<index+1>/<total>] <name>` — legacy line emitted at the START of each
 *    component (and again on retry). With concurrency > 1, the index reflects
 *    the worker's starting position, not completions, so it MUST NOT drive
 *    `done` — only `current` (the name shown to the user).
 *
 * Given a chunk and the previous state, returns the updated state.
 */
export type GenerateProgressState = { done: number; total: number; current: string } | null;

const PROGRESS_LINE = /^progress=generate:(\d+)\/(\d+):(.+)$/;
const LEGACY_LINE = /\[(\d+)\/(\d+)\]\s+(.+)/;

export function parseGenerateStderrChunk(chunk: string, prev: GenerateProgressState): GenerateProgressState {
  let state: GenerateProgressState = prev;
  for (const line of chunk.split('\n')) {
    const progressMatch = PROGRESS_LINE.exec(line);
    if (progressMatch) {
      state = {
        done: Number(progressMatch[1]),
        total: Number(progressMatch[2]),
        current: progressMatch[3]!.trim(),
      };
      continue;
    }
    const legacyMatch = LEGACY_LINE.exec(line);
    if (legacyMatch) {
      state = {
        done: state?.done ?? 0,
        total: Number(legacyMatch[2]),
        current: legacyMatch[3]!.trim(),
      };
    }
  }
  return state;
}
