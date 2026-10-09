import { homedir } from 'node:os';
import { resolve } from 'node:path';

function stripQuotes(value: string): string {
  const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  return value.length >= 2 && quoted ? value.slice(1, -1) : value;
}

function expandHome(value: string): string {
  return value === '~' || value.startsWith('~/') || value.startsWith('~\\') ? homedir() + value.slice(1) : value;
}

export function resolveUserPath(raw: string): string {
  return resolve(expandHome(stripQuotes(raw.trim())));
}
