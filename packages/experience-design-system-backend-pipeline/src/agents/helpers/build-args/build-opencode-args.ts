export function buildOpencodeArgs(modelArg: string[], promptArg: string[], conversation?: { id?: string }): string[] {
  return [
    'run',
    ...(conversation ? ['--format', 'json'] : []),
    ...(conversation?.id ? ['--session', conversation.id] : []),
    ...modelArg,
    ...promptArg,
  ];
}
