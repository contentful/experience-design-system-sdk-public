import { DENYLISTED_EXACT_FILE_NAMES, DENYLISTED_FILE_NAME_PATTERNS } from '../../constants/file-patterns.js';

/**
 * True when a filename inside the denylist-gated extension set is known noise
 * (package.json, tsconfig*.json, README.md, etc.) and should be skipped by
 * the walker. Keeps `.json` and `.md` scanning useful for Figma manifests
 * and AGENTS.md-style docs while filtering out config / repo-boilerplate.
 */
export function isNoiseConfigFile(name: string): boolean {
  return DENYLISTED_EXACT_FILE_NAMES.has(name) || DENYLISTED_FILE_NAME_PATTERNS.some((pattern) => pattern.test(name));
}
