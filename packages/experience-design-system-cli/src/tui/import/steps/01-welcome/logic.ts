export function toProjectPath(value: string): string | null {
  const projectPath = value.trim();
  return projectPath === '' ? null : projectPath;
}
