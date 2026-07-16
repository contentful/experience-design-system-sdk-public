import { readFile } from 'node:fs/promises';
import { validateInterchangeMap, type InterchangeMap } from './interchange-schema.js';

export type CompositionCliOptions = {
  /** `--composition-map <path>` — hand-authored interchange file. */
  compositionMap?: string;
  /** `--composition-agent` — opt into agentic resolution. */
  compositionAgent?: boolean;
  /** `--composition-refresh` — force the agent to run even over resolved residue. */
  compositionRefresh?: boolean;
};

export type LoadUserMapResult = { ok: true; map: InterchangeMap } | { ok: false; error: string };

/** Read + validate a hand-authored interchange map (spec T1 / §1.2 third mechanism). */
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
  const res = validateInterchangeMap(parsed);
  if (!res.valid) return { ok: false, error: `--composition-map: ${res.errors.join('; ')}` };
  return { ok: true, map: res.map };
}

export type ResolvedCompositionSources = {
  useAgent: boolean;
  forceAgent: boolean;
};

export function resolveCompositionSources(opts: CompositionCliOptions): ResolvedCompositionSources {
  return {
    useAgent: !!opts.compositionAgent,
    forceAgent: !!opts.compositionRefresh,
  };
}
