import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';

const nearestTsConfigPathCache = new Map<string, string | null>();
const tsConfigPathsCache = new Map<string, { baseUrl: string; paths: Record<string, readonly string[]> } | null>();

export function matchTsConfigPathPattern(pattern: string, specifier: string): { matched: boolean; wildcard?: string } {
  if (!pattern.includes('*')) return { matched: pattern === specifier };
  const [prefix, suffix] = pattern.split('*');
  if (!specifier.startsWith(prefix!) || !specifier.endsWith(suffix!)) return { matched: false };
  return {
    matched: true,
    wildcard: specifier.slice(prefix!.length, specifier.length - suffix!.length),
  };
}

export function substituteTsConfigPathTarget(targetPattern: string, wildcard: string | undefined): string {
  return wildcard === undefined ? targetPattern : targetPattern.replace('*', wildcard);
}

function findNearestTsConfigPath(filePath: string): string | undefined {
  if (nearestTsConfigPathCache.has(filePath)) return nearestTsConfigPathCache.get(filePath) ?? undefined;
  let currentDir = dirname(filePath);
  while (true) {
    for (const candidateName of ['tsconfig.json', 'jsconfig.json']) {
      const candidatePath = join(currentDir, candidateName);
      if (existsSync(candidatePath)) {
        nearestTsConfigPathCache.set(filePath, candidatePath);
        return candidatePath;
      }
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      nearestTsConfigPathCache.set(filePath, null);
      return undefined;
    }
    currentDir = parentDir;
  }
}

function getTsConfigPaths(
  tsConfigPath: string,
): { baseUrl: string; paths: Record<string, readonly string[]> } | undefined {
  if (tsConfigPathsCache.has(tsConfigPath)) return tsConfigPathsCache.get(tsConfigPath) ?? undefined;
  const configFile = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
  if (configFile.error || !configFile.config) {
    tsConfigPathsCache.set(tsConfigPath, null);
    return undefined;
  }
  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(tsConfigPath));
  const paths = parsedConfig.options.paths;
  if (!paths || Object.keys(paths).length === 0) {
    tsConfigPathsCache.set(tsConfigPath, null);
    return undefined;
  }
  const baseUrl = parsedConfig.options.baseUrl ?? dirname(tsConfigPath);
  const result = { baseUrl, paths };
  tsConfigPathsCache.set(tsConfigPath, result);
  return result;
}

export function resolveImportSourcePath(basePath: string): string | undefined {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    join(basePath, 'index.ts'),
    join(basePath, 'index.tsx'),
    join(basePath, 'index.js'),
    join(basePath, 'index.jsx'),
  ];
  return candidates.find((candidatePath) => existsSync(candidatePath));
}

export function resolveRepoLocalAliasImportPath(
  importingFilePath: string,
  moduleSpecifier: string,
): string | undefined {
  const nearestTsConfigPath = findNearestTsConfigPath(importingFilePath);
  if (!nearestTsConfigPath) return undefined;
  const tsConfigPaths = getTsConfigPaths(nearestTsConfigPath);
  if (!tsConfigPaths) return undefined;
  for (const [pattern, targets] of Object.entries(tsConfigPaths.paths)) {
    const match = matchTsConfigPathPattern(pattern, moduleSpecifier);
    if (!match.matched) continue;
    for (const targetPattern of targets) {
      const substitutedTarget = substituteTsConfigPathTarget(targetPattern, match.wildcard);
      const resolvedPath = resolve(tsConfigPaths.baseUrl, substitutedTarget);
      const sourceFilePath = resolveImportSourcePath(resolvedPath);
      if (sourceFilePath) return sourceFilePath;
    }
  }
  return undefined;
}
