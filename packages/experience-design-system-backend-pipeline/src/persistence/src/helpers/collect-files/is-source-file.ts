import path from 'node:path';
import {
  DENYLIST_GATED_EXTENSIONS,
  EXCLUDED_SUFFIXES,
  INCLUDED_EXTENSIONS,
  isNoiseConfigFile,
} from '../../constants/file-patterns.js';

/**
 * True when a filename should land in the walk output. Rules in order:
 *   1. `.d.ts` disqualifies — type declarations aren't source.
 *   2. Test/story/spec suffixes disqualify.
 *   3. Framework extensions (.ts, .tsx, .vue, .svelte, .astro, .js, .jsx) qualify.
 *   4. `.json` / `.md` qualify unless the filename matches a known-noise config pattern.
 */
export function isSourceFile(name: string): boolean {
  if (name.endsWith('.d.ts')) return false;
  if (EXCLUDED_SUFFIXES.some((suffix) => name.endsWith(suffix))) return false;
  const ext = path.extname(name);
  if (INCLUDED_EXTENSIONS.has(ext)) return true;
  if (DENYLIST_GATED_EXTENSIONS.has(ext) && !isNoiseConfigFile(name)) return true;
  return false;
}
