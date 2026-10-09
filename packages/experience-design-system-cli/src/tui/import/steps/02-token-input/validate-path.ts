import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

interface TokenPathFailure {
  error: string;
  resolvedPath: string;
}

type TokenPathCheck = { ok: true; path: string } | ({ ok: false } & TokenPathFailure);

function stripQuotes(value: string): string {
  const quoted = (value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"));
  return value.length >= 2 && quoted ? value.slice(1, -1) : value;
}

function expandHome(value: string): string {
  return value === '~' || value.startsWith('~/') || value.startsWith('~\\') ? homedir() + value.slice(1) : value;
}

export function validateTokenPath(rawPath: string): TokenPathCheck {
  const path = resolve(expandHome(stripQuotes(rawPath.trim())));

  let stats;
  try {
    stats = statSync(path);
  } catch {
    return { ok: false, error: `Path not found: ${path}`, resolvedPath: path };
  }

  if (stats.isDirectory()) {
    return {
      ok: false,
      error: "That's a directory — provide a path to a token file (e.g. tokens.json), not a folder.",
      resolvedPath: path,
    };
  }
  if (!stats.isFile()) {
    return { ok: false, error: `Not a regular file: ${path}`, resolvedPath: path };
  }
  return { ok: true, path };
}
