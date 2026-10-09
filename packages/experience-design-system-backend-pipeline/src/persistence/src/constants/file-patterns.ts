/** Source extensions the extractor framework-adapters know how to parse. */
export const INCLUDED_EXTENSIONS = new Set(['.astro', '.js', '.jsx', '.svelte', '.ts', '.tsx', '.vue']);

/**
 * Extensions scanned but gated by name-level denylisting below. These carry
 * design-adjacent evidence (Figma `manifest.json`, `AGENTS.md`-style docs)
 * that non-LLM extractors deterministically parse.
 */
export const DENYLIST_GATED_EXTENSIONS = new Set(['.json', '.md']);

/** Suffixes that always disqualify a file (tests, stories, type declarations). */
export const EXCLUDED_SUFFIXES = [
  '.d.ts',
  '.stories.ts',
  '.stories.tsx',
  '.stories.js',
  '.stories.jsx',
  '.story.ts',
  '.story.tsx',
  '.story.js',
  '.story.jsx',
  '.test.ts',
  '.test.tsx',
  '.test.js',
  '.test.jsx',
  '.spec.ts',
  '.spec.tsx',
  '.spec.js',
  '.spec.jsx',
];

/** Directories skipped entirely during the walk. */
export const IGNORED_DIRS = new Set([
  '.changeset',
  '.git',
  '.github',
  '.idea',
  '.next',
  '.nuxt',
  '.nx',
  '.vscode',
  'build',
  'coverage',
  'demo',
  'demos',
  'dist',
  'example',
  'examples',
  'node_modules',
  'out',
  'storybook-static',
]);

/** Exact filenames inside `DENYLIST_GATED_EXTENSIONS` that are known-noise and always skipped. */
export const DENYLISTED_EXACT_FILE_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'nx.json',
  'project.json',
  'turbo.json',
  'lerna.json',
  'jsconfig.json',
]);

/** Config-file families that vary by suffix (`tsconfig.build.json`, `.eslintrc.cjs.json`, …) plus common repo docs. */
export const DENYLISTED_FILE_NAME_PATTERNS = [
  /^tsconfig(\..+)?\.json$/,
  /^\.?eslintrc(\..+)?\.json$/,
  /^\.?prettierrc(\..+)?\.json$/,
  /^(readme|changelog|contributing|code_of_conduct|license|security)(\..+)?\.md$/i,
];

export function isNoiseConfigFile(name: string): boolean {
  return DENYLISTED_EXACT_FILE_NAMES.has(name) || DENYLISTED_FILE_NAME_PATTERNS.some((pattern) => pattern.test(name));
}
