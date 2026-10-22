export function toTokenPath(value: string): string | null {
  const tokenPath = value.trim();
  return tokenPath === '' ? null : tokenPath;
}
