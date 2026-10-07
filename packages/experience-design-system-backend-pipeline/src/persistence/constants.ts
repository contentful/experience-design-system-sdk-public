export const INCLUDED_EXTENSIONS = new Set(['.astro', '.js', '.jsx', '.svelte', '.ts', '.tsx', '.vue']);

export const EXCLUDED_SUFFIXES = [
  '.d.ts',
  '.stories.ts',
  '.stories.tsx',
  '.stories.js',
  '.stories.jsx',
  '.test.ts',
  '.test.tsx',
  '.test.js',
  '.test.jsx',
  '.spec.ts',
  '.spec.tsx',
  '.spec.js',
  '.spec.jsx',
];

export const IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'build',
  'coverage',
  '.next',
  '.vscode',
  '.nx',
]);
