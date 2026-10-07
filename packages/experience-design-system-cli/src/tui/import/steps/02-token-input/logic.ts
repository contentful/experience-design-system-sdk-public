interface Key {
  escape: boolean;
  ctrl: boolean;
  meta: boolean;
}

function isPlainKeyOnEmptyField(value: string, input: string, key: Key, expected: string): boolean {
  return value === '' && input === expected && !key.ctrl && !key.meta;
}

export function shouldGoBack(value: string, input: string, key: Key): boolean {
  return key.escape || isPlainKeyOnEmptyField(value, input, key, 'q');
}

export function shouldSkip(value: string, input: string, key: Key): boolean {
  return isPlainKeyOnEmptyField(value, input, key, 's');
}

export function toTokenPath(value: string): string | null {
  const tokenPath = value.trim();
  return tokenPath === '' ? null : tokenPath;
}
