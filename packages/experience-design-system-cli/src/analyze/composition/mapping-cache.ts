import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { validateInterchangeMap, type InterchangeMap } from './interchange-schema.js';

/**
 * On-disk cache for resolved composition maps (spec T5). Keyed by
 * `buildMappingCacheKey` so a re-run with unchanged candidate files + producer
 * reuses the result instead of re-invoking the (token-costly) agent.
 *
 * Lives under the CLI state dir, never in the customer repo. Any read failure
 * — missing, unreadable, malformed, or schema-invalid — is treated as a miss
 * so a bad cache entry can never break resolution.
 */
export function defaultMappingCacheDir(): string {
  return resolve(homedir(), '.contentful', 'experience-design-system-cli', 'composition-cache');
}

type CacheOpts = { cacheDir?: string };

function cacheFilePath(key: string, opts: CacheOpts): string {
  return join(opts.cacheDir ?? defaultMappingCacheDir(), `${key}.json`);
}

export async function readMappingCache(key: string, opts: CacheOpts = {}): Promise<InterchangeMap | null> {
  let text: string;
  try {
    text = await readFile(cacheFilePath(key, opts), 'utf8');
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const res = validateInterchangeMap(parsed);
  return res.valid ? res.map : null;
}

export async function writeMappingCache(key: string, map: InterchangeMap, opts: CacheOpts = {}): Promise<void> {
  const path = cacheFilePath(key, opts);
  try {
    await mkdir(opts.cacheDir ?? defaultMappingCacheDir(), { recursive: true });
    await writeFile(path, JSON.stringify(map, null, 2) + '\n');
  } catch {
    // Cache write is best-effort — a failure must never break the run.
  }
}

/**
 * Raw-string cache variant for the agent's stdout — keyed the same way, but the
 * value is the agent's unparsed output (parsed downstream by the resolver, so
 * the parse discipline is identical hit or miss). A read failure is a miss.
 */
export async function readRawAgentCache(key: string, opts: CacheOpts = {}): Promise<string | null> {
  try {
    return await readFile(join(opts.cacheDir ?? defaultMappingCacheDir(), `${key}.agent.txt`), 'utf8');
  } catch {
    return null;
  }
}

export async function writeRawAgentCache(key: string, raw: string, opts: CacheOpts = {}): Promise<void> {
  try {
    await mkdir(opts.cacheDir ?? defaultMappingCacheDir(), { recursive: true });
    await writeFile(join(opts.cacheDir ?? defaultMappingCacheDir(), `${key}.agent.txt`), raw);
  } catch {
    /* best-effort */
  }
}
