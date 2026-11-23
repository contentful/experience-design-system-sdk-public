export function buildCursorArgs(modelArg: string[], promptArg: string[], conversation?: { id?: string }): string[] {
  return [
    '--print',
    ...(conversation ? ['--output-format', 'stream-json'] : []),
    ...(conversation?.id ? ['--resume', conversation.id] : []),
    ...modelArg,
    ...promptArg,
  ];
}
