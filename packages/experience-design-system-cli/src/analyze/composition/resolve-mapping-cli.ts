import { readFile } from 'node:fs/promises';
import { validateInterchangeMap, type InterchangeMap } from './interchange-schema.js';

export type CompositionCliOptions = {
  /** `--composition-map <path>` — hand-authored interchange file. */
  compositionMap?: string;
  /** `--composition-refresh` — force edge emission to run even over resolved residue. */
  compositionRefresh?: boolean;
};

export type LoadUserMapResult = { ok: true; map: InterchangeMap } | { ok: false; error: string };

export async function loadUserMap(path: string): Promise<LoadUserMapResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return { ok: false, error: `--composition-map: file not found: ${path}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: `--composition-map: not valid JSON: ${path}` };
  }
  const result = validateInterchangeMap(parsed);
  if (!result.valid) return { ok: false, error: `--composition-map: ${result.errors.join('; ')}` };
  return { ok: true, map: result.map };
}

export type ResolvedCompositionSources = {
  forceAgent: boolean;
};

export function resolveCompositionSources(opts: CompositionCliOptions): ResolvedCompositionSources {
  return {
    forceAgent: !!opts.compositionRefresh,
  };
}
