interface QuitKey {
  escape: boolean;
  ctrl: boolean;
  meta: boolean;
}

export function shouldQuit(value: string, input: string, key: QuitKey): boolean {
  if (key.escape) return true;
  return value === '' && input === 'q' && !key.ctrl && !key.meta;
}

export function toProjectPath(value: string): string | null {
  const projectPath = value.trim();
  return projectPath === '' ? null : projectPath;
}
