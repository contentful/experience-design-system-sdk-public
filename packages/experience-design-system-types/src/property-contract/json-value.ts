export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface PropertyIssue {
  path: string;
  message: string;
}
export const own = (value: object, key: PropertyKey): boolean => Object.hasOwn(value, key);
export const childPath = (path: string, key: string | number): string =>
  `${path}/${String(key).replace(/~/g, '~0').replace(/\//g, '~1')}`;

/** Inspect descriptors before reading values; aliases are allowed, cycles are not. */
export function jsonValueIssue(value: unknown, path = '', ancestors = new Set<object>()): PropertyIssue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number')
    return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))
      ? undefined
      : { path, message: 'Expected finite JSON-safe number' };
  if (typeof value !== 'object') return { path, message: 'Expected JSON value' };
  if (nodeTypes?.isProxy(value)) return { path, message: 'Proxy is not supported JSON data' };
  if (ancestors.has(value)) return { path, message: 'Cyclic JSON value' };
  const array = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (array && proto !== Array.prototype) return { path, message: 'Custom array prototype' };
  if (!array && proto !== Object.prototype && proto !== null) return { path, message: 'Custom object prototype' };
  ancestors.add(value);
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === 'length') continue;
      if (typeof key !== 'string') return { path, message: 'Symbol key is not JSON' };
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))
        return { path: childPath(path, key), message: 'Extra array member' };
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !own(descriptor, 'value'))
        return { path: childPath(path, key), message: 'Expected enumerable data member' };
      const issue = jsonValueIssue(descriptor.value, childPath(path, key), ancestors);
      if (issue) return issue;
    }
    if (array)
      for (let i = 0; i < value.length; i++)
        if (!own(value, i)) return { path: childPath(path, i), message: 'Sparse array' };
  } finally {
    ancestors.delete(value);
  }
  return undefined;
}

export function jsonEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right) || left === right) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left).sort();
  const other = Object.keys(right).sort();
  return (
    keys.length === other.length &&
    keys.every(
      (key, i) =>
        key === other[i] && jsonEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
    )
  );
}
export function cloneJson<T>(value: T): T {
  const issue = jsonValueIssue(value);
  if (issue) throw new Error(`${issue.path}: ${issue.message}`);
  return JSON.parse(JSON.stringify(value)) as T;
}
export function freezeJson<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freezeJson(item);
    Object.freeze(value);
  }
  return value;
}
const nodeTypes = (
  globalThis as typeof globalThis & {
    process?: { getBuiltinModule?: (name: string) => { types: { isProxy: (value: unknown) => boolean } } };
  }
).process?.getBuiltinModule?.('node:util')?.types;

/** Parse the entire document and reject duplicate decoded own keys. */
export function parseStrictJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  let cursor = 0;
  const whitespace = (): void => {
    while (/\s/.test(text[cursor] ?? '') && cursor < text.length) cursor++;
  };
  const string = (): string => {
    const start = cursor++;
    while (cursor < text.length) {
      const char = text[cursor++]!;
      if (char === '\\') cursor++;
      else if (char === '"') return JSON.parse(text.slice(start, cursor)) as string;
    }
    throw new Error('Unterminated JSON string');
  };
  const value = (): void => {
    whitespace();
    if (text[cursor] === '{') {
      cursor++;
      whitespace();
      const keys = new Set<string>();
      if (text[cursor] === '}') {
        cursor++;
        return;
      }
      while (cursor < text.length) {
        whitespace();
        const key = string();
        if (keys.has(key)) throw new Error('Duplicate JSON object key');
        keys.add(key);
        whitespace();
        cursor++;
        value();
        whitespace();
        if (text[cursor++] === '}') return;
      }
    } else if (text[cursor] === '[') {
      cursor++;
      whitespace();
      if (text[cursor] === ']') {
        cursor++;
        return;
      }
      while (cursor < text.length) {
        value();
        whitespace();
        if (text[cursor++] === ']') return;
      }
    } else if (text[cursor] === '"') string();
    else {
      while (cursor < text.length && !/[\s,}\]]/.test(text[cursor]!)) cursor++;
    }
  };
  value();
  const issue = jsonValueIssue(parsed);
  if (issue) throw new Error(`${issue.path}: ${issue.message}`);
  return parsed;
}
