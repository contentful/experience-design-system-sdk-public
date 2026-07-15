import { readFile } from 'node:fs/promises';
import { validateInterchangeMap, type InterchangeMap } from './interchange-schema.js';
import { getBuiltinAdapter, type CompositionAdapter } from './adapters/index.js';

export type CompositionCliOptions = {
  /** `--composition-map <path>` — hand-authored interchange file. */
  compositionMap?: string;
  /** `--composition-adapter <name|path>` — built-in name or custom module path. */
  compositionAdapter?: string;
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
  adapter?: CompositionAdapter;
  useAgent: boolean;
  forceAgent: boolean;
  errors: string[];
};

export function resolveCompositionSources(opts: CompositionCliOptions): ResolvedCompositionSources {
  const errors: string[] = [];
  let adapter: CompositionAdapter | undefined;

  if (opts.compositionAdapter) {
    const value = opts.compositionAdapter;
    const looksLikePath = value.includes('/') || value.includes('.');
    if (looksLikePath) {
      adapter = undefined;
    } else {
      const builtin = getBuiltinAdapter(value);
      if (!builtin) {
        errors.push(`--composition-adapter: unknown built-in adapter "${value}"`);
      } else {
        adapter = builtin.adapter;
      }
    }
  }

  return {
    adapter,
    useAgent: !!opts.compositionAgent,
    forceAgent: !!opts.compositionRefresh,
    errors,
  };
}
