export function buildClaudeArgs(modelArg: string[], promptArg: string[]): string[] {
  return ['--print', ...modelArg, ...promptArg];
}
