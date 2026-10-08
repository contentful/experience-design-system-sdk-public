interface QuitKey {
  escape: boolean;
}

export function shouldQuit(key: QuitKey): boolean {
  return key.escape;
}

export function toProjectPath(value: string): string | null {
  const projectPath = value.trim();
  return projectPath === '' ? null : projectPath;
}
