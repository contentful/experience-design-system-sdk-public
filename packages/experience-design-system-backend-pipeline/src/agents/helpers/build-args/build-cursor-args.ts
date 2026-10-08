export function buildCursorArgs(modelArg: string[], promptArg: string[]): string[] {
  return ['--print', ...modelArg, ...promptArg];
}
