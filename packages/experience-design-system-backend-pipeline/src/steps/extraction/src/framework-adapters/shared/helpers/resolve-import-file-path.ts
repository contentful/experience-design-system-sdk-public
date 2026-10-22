import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export function resolveLocalModule(
  importingFilePath: string,
  specifier: string,
  options: { allowJavaScriptExtensionFallback?: boolean } = {},
): string | null {
  const basePath = resolve(dirname(importingFilePath), specifier);
  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.ts`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    join(basePath, 'index.js'),
    join(basePath, 'index.ts'),
    join(basePath, 'index.mjs'),
    join(basePath, 'index.cjs'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }

  if (options.allowJavaScriptExtensionFallback && basePath.endsWith('.js')) {
    const tsPath = `${basePath.slice(0, -'.js'.length)}.ts`;
    if (existsSync(tsPath) && statSync(tsPath).isFile()) return tsPath;
  }

  return null;
}
