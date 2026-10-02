/** Formats the completion event consumed by the CLI wizard progress parser. */
export function formatGenerateProgressLine(done: number, total: number, name: string): string {
  return `progress=generate:${done}/${total}:${name}`;
}
