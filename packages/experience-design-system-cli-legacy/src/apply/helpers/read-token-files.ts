import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { flattenDTCG, validateDTCG } from '@contentful/experience-design-system-types';
import type { CDFTokenEntry, DTCGTokenEntry } from '@contentful/experience-design-system-types';
import { exitWithAnalytics } from '../../analytics/index.js';

async function die(message: string): Promise<never> {
  process.stderr.write(`${message}\n`);
  return exitWithAnalytics(1);
}

export async function readJsonFile(flag: string, p: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(p, 'utf8');
  } catch {
    return await die(`Error: file not found: ${p} (from ${flag})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return await die(`Error: ${flag} is not valid JSON: ${p}`);
  }
}

const IGNORE_TOKEN_DIRS = new Set(['node_modules', 'dist', 'build', '.next', '.nuxt', '.git']);

async function collectJsonFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string) {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (entry) => {
        if (IGNORE_TOKEN_DIRS.has(entry)) return;
        const full = join(current, entry);
        let s;
        try {
          s = await stat(full);
        } catch {
          return;
        }
        if (s.isDirectory()) {
          await walk(full);
        } else if (entry.endsWith('.json')) {
          results.push(full);
        }
      }),
    );
  }
  await walk(dir);
  return results;
}

export async function readTokensFromPath(flag: string, p: string): Promise<DTCGTokenEntry[]> {
  let s;
  try {
    s = await stat(p);
  } catch {
    return await die(`Error: file not found: ${p} (from ${flag})`);
  }
  if (s.isDirectory()) {
    const files = await collectJsonFiles(p);
    if (files.length === 0) return await die(`Error: no .json files found in directory: ${p} (from ${flag})`);
    const merged: Record<string, unknown> = {};
    for (const file of files.sort()) {
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        continue;
      }
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        Object.assign(merged, parsed as Record<string, unknown>);
      }
    }
    const { valid, errors } = validateDTCG(merged);
    if (!valid)
      return await die(
        `Error: ${flag} contains invalid token types:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
      );
    return flattenDTCG(merged, '');
  }
  const raw = await readJsonFile(flag, p);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return await die(`Error: ${flag} is not valid JSON: expected an object`);
  }
  const { valid, errors } = validateDTCG(raw as Record<string, unknown>);
  if (!valid)
    return await die(
      `Error: ${flag} contains invalid token types:\n${errors.map((e) => `  ${e.path}: ${e.message}`).join('\n')}`,
    );
  return flattenDTCG(raw as Record<string, unknown>, '');
}

export function toCDFTokens(tokens: DTCGTokenEntry[]): Array<{ path: string; entry: CDFTokenEntry }> {
  return tokens.map(({ path, ...entry }) => ({ path, entry }));
}
