import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SCANNED_FILE_EXTENSIONS = new Set(['.astro', '.js', '.jsx', '.svelte', '.ts', '.tsx', '.vue']);
const DENYLIST_GATED_EXTENSIONS = new Set(['.json', '.md']);
const DENYLISTED_EXACT_FILE_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'nx.json',
  'project.json',
  'turbo.json',
  'lerna.json',
  'jsconfig.json',
]);
const DENYLISTED_FILE_NAME_PATTERNS = [
  /^tsconfig(\..+)?\.json$/,
  /^\.?eslintrc(\..+)?\.json$/,
  /^\.?prettierrc(\..+)?\.json$/,
  /^(readme|changelog|contributing|code_of_conduct|license|security)(\..+)?\.md$/i,
];
const IGNORED_DIRECTORY_NAMES = new Set([
  '.changeset',
  '.git',
  '.github',
  '.idea',
  '.next',
  '.nuxt',
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
const IGNORED_FILE_SUFFIXES = new Set([
  '.stories.ts',
  '.stories.tsx',
  '.stories.js',
  '.stories.jsx',
  '.story.ts',
  '.story.tsx',
  '.story.js',
  '.story.jsx',
  '.spec.ts',
  '.spec.tsx',
  '.test.ts',
  '.test.tsx',
]);

function isDenylistedNoiseFile(name: string): boolean {
  return DENYLISTED_EXACT_FILE_NAMES.has(name) || DENYLISTED_FILE_NAME_PATTERNS.some((p) => p.test(name));
}

export async function collectSourceFiles(
  directory: string,
  onProgress?: (scannedCount: number) => void,
): Promise<string[]> {
  const files: string[] = [];

  async function visit(currentDirectory: string): Promise<void> {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    const subdirs: string[] = [];

    for (const entry of entries) {
      const fullPath = join(currentDirectory, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) subdirs.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const extension = entry.name.slice(entry.name.lastIndexOf('.'));
      const isCodeFile = SCANNED_FILE_EXTENSIONS.has(extension) && !entry.name.endsWith('.d.ts');
      const isNoiseGatedFile = DENYLIST_GATED_EXTENSIONS.has(extension) && !isDenylistedNoiseFile(entry.name);
      if (!isCodeFile && !isNoiseGatedFile) continue;

      if ([...IGNORED_FILE_SUFFIXES].some((suffix) => entry.name.endsWith(suffix))) continue;

      files.push(fullPath);
      onProgress?.(files.length);
    }

    await Promise.all(subdirs.map((subdir) => visit(subdir)));
  }

  await visit(directory);
  return files.sort();
}
