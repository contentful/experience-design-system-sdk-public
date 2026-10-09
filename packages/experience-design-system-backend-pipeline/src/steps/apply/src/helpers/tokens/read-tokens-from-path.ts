import { readFile, stat } from 'node:fs/promises';
import type { DTCGTokenEntry } from '../../../../shared/index.js';
import { flattenDTCG, validateDTCG } from '../../../../shared/index.js';
import { collectJsonFiles } from './collect-json-files.js';

/**
 * Read a DTCG tokens file (or directory of files) from disk and return a
 * flat list of DTCG token entries. Validates the merged shape; throws with
 * a human-readable message on any error.
 *
 * `flag` is the originating CLI flag name (e.g. `'tokens'`); surfaced in
 * error messages so the user knows which input was bad.
 */
export async function readTokensFromPath(flag: string, p: string): Promise<DTCGTokenEntry[]> {
  let s;
  try {
    s = await stat(p);
  } catch {
    throw new Error(`file not found: ${p} (from ${flag})`);
  }
  const merged = s.isDirectory() ? await readMergedFromDir(flag, p) : await readSingleFile(flag, p);
  const { valid, errors } = validateDTCG(merged);
  if (!valid) {
    throw new Error(
      `${flag} contains invalid token types:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
    );
  }
  return flattenDTCG(merged, '');
}

async function readMergedFromDir(flag: string, dir: string): Promise<Record<string, unknown>> {
  const files = await collectJsonFiles(dir);
  if (files.length === 0) throw new Error(`no .json files found in directory: ${dir} (from ${flag})`);
  const merged: Record<string, unknown> = {};
  for (const file of files.sort()) {
    try {
      const text = await readFile(file, 'utf8');
      const parsed = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        Object.assign(merged, parsed as Record<string, unknown>);
      }
    } catch {
      continue;
    }
  }
  return merged;
}

async function readSingleFile(flag: string, p: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readFile(p, 'utf8');
  } catch {
    throw new Error(`file not found: ${p} (from ${flag})`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${flag} is not valid JSON: ${p}`);
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${flag} is not valid JSON: expected an object`);
  }
  return raw as Record<string, unknown>;
}
