/**
 * Formats a structured generation-progress line for the wizard parser.
 *
 * Emitted at terminal completion of each component (success, cache hit,
 * pinned hit, or final failure). `done` represents the count of completed
 * components, which is monotonically non-decreasing — unlike the legacy
 * `[index+1/total]` line, which reports input position.
 */
export function formatGenerateProgressLine(done: number, total: number, name: string): string {
  return `progress=generate:${done}/${total}:${name}`;
}
