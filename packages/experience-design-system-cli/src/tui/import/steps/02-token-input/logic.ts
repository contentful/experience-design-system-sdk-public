interface Key {
  escape: boolean;
}

export function shouldGoBack(key: Key): boolean {
  return key.escape;
}

export function toTokenPath(value: string): string | null {
  const tokenPath = value.trim();
  return tokenPath === '' ? null : tokenPath;
}
