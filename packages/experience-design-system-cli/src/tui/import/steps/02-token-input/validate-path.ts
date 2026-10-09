import { statSync } from 'node:fs';
import { resolveUserPath } from '../../resolve-user-path.js';

interface TokenPathFailure {
  error: string;
  resolvedPath: string;
}

type TokenPathCheck = { ok: true; path: string } | ({ ok: false } & TokenPathFailure);

export function validateTokenPath(rawPath: string): TokenPathCheck {
  const path = resolveUserPath(rawPath);

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
