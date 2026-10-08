export function buildOpencodeArgs(modelArg: string[], promptArg: string[]): string[] {
  return ['run', ...modelArg, ...promptArg];
}
