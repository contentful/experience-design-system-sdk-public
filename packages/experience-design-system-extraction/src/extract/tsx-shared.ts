import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Node, Project, type SourceFile, type Type } from 'ts-morph';
import ts from 'typescript';

type WorkspacePackageManifest = {
  name: string;
  rootDir: string;
};

const packageRootByFilePathCache = new Map<string, string | null>();
const workspacePackageManifestCache = new Map<string, WorkspacePackageManifest | null>();
const nearestTsConfigPathCache = new Map<string, string | null>();
const tsConfigPathsCache = new Map<string, { baseUrl: string; paths: Record<string, readonly string[]> } | null>();

export function extractAllowedValues(type: Type): string[] | undefined {
  if (!type.isUnion()) return undefined;

  const literals = type
    .getUnionTypes()
    .filter((t) => t.isStringLiteral())
    .map((t) => t.getLiteralValueOrThrow() as string);

  return literals.length >= 2 ? literals.sort() : undefined;
}

export function getNodeDefinitions(node: Node): { getDeclarationNode(): Node | undefined }[] {
  const anyNode = node as unknown as {
    getDefinitions?: () => { getDeclarationNode(): Node | undefined }[];
  };
  return anyNode.getDefinitions?.() ?? [];
}

export function getTypeTargetDeclarations(targetNode: Node, allowWorkspaceImportFallback = false): Node[] {
  return getNodeDefinitions(targetNode).flatMap((definition) => {
    const declaration = definition.getDeclarationNode();
    if (!declaration) return [];

    if (!allowWorkspaceImportFallback || !Node.isImportSpecifier(declaration)) {
      return [declaration];
    }

    const resolvedDeclarations = resolveWorkspaceImportSpecifierDeclarations(declaration, targetNode);
    return resolvedDeclarations.length > 0 ? resolvedDeclarations : [declaration];
  });
}

export function getValueTargetDeclarations(targetNode: Node): Node[] {
  return getNodeDefinitions(targetNode).flatMap((definition) => {
    const declaration = definition.getDeclarationNode();
    if (!declaration) return [];

    if (!Node.isImportSpecifier(declaration)) {
      return [declaration];
    }

    const resolvedDeclarations = resolveWorkspaceImportSpecifierDeclarations(declaration, targetNode);
    return resolvedDeclarations.length > 0 ? resolvedDeclarations : [declaration];
  });
}

export function getTypeReferenceName(typeNode: Node): string | undefined {
  if (Node.isTypeReference(typeNode)) {
    return typeNode.getTypeName().getText().split('.').pop();
  }

  if (Node.isExpressionWithTypeArguments(typeNode)) {
    return typeNode.getExpression().getText().split('.').pop();
  }

  return undefined;
}

function resolveWorkspaceImportSpecifierDeclarations(importSpecifier: Node, referenceNode: Node): Node[] {
  if (!Node.isImportSpecifier(importSpecifier)) return [];

  const importDeclaration = importSpecifier.getImportDeclaration();
  const moduleSpecifierSourceFile = importDeclaration.getModuleSpecifierSourceFile();
  if (moduleSpecifierSourceFile) {
    return getExportedDeclarationsForImportSpecifier(importSpecifier, moduleSpecifierSourceFile);
  }

  const moduleSpecifier = importDeclaration.getModuleSpecifierValue();
  if (!isBareModuleSpecifier(moduleSpecifier)) return [];

  const workspaceEntrySourceFile = findWorkspacePackageEntrySourceFile(referenceNode.getSourceFile(), moduleSpecifier);
  if (workspaceEntrySourceFile) {
    return getExportedDeclarationsForImportSpecifier(importSpecifier, workspaceEntrySourceFile);
  }

  const aliasedSourceFile = findRepoLocalAliasSourceFile(referenceNode.getSourceFile(), moduleSpecifier);
  if (!aliasedSourceFile) return [];

  return getExportedDeclarationsForImportSpecifier(importSpecifier, aliasedSourceFile);
}

function getExportedDeclarationsForImportSpecifier(importSpecifier: Node, sourceFile: SourceFile): Node[] {
  if (!Node.isImportSpecifier(importSpecifier)) return [];

  const exportedName = importSpecifier.getNameNode().getText();
  return sourceFile.getExportedDeclarations().get(exportedName) ?? [];
}

function isBareModuleSpecifier(moduleSpecifier: string): boolean {
  return !moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/');
}

function findRepoLocalAliasSourceFile(originSourceFile: SourceFile, moduleSpecifier: string): SourceFile | undefined {
  const resolvedPath = resolveRepoLocalAliasImportPath(originSourceFile.getFilePath(), moduleSpecifier);
  if (!resolvedPath) return undefined;

  const project = originSourceFile.getProject();
  return findProjectSourceFileByImportPath(project, resolvedPath);
}

function resolveRepoLocalAliasImportPath(importingFilePath: string, moduleSpecifier: string): string | undefined {
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

function findNearestTsConfigPath(filePath: string): string | undefined {
  if (nearestTsConfigPathCache.has(filePath)) {
    return nearestTsConfigPathCache.get(filePath) ?? undefined;
  }

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
  if (tsConfigPathsCache.has(tsConfigPath)) {
    return tsConfigPathsCache.get(tsConfigPath) ?? undefined;
  }

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

function matchTsConfigPathPattern(pattern: string, specifier: string): { matched: boolean; wildcard?: string } {
  if (!pattern.includes('*')) {
    return { matched: pattern === specifier };
  }

  const [prefix, suffix] = pattern.split('*');
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) {
    return { matched: false };
  }

  return {
    matched: true,
    wildcard: specifier.slice(prefix.length, specifier.length - suffix.length),
  };
}

function substituteTsConfigPathTarget(targetPattern: string, wildcard: string | undefined): string {
  return wildcard === undefined ? targetPattern : targetPattern.replace('*', wildcard);
}

function resolveImportSourcePath(basePath: string): string | undefined {
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

function findProjectSourceFileByImportPath(project: Project, resolvedPath: string): SourceFile | undefined {
  const candidatePaths = [
    resolvedPath,
    `${resolvedPath}.ts`,
    `${resolvedPath}.tsx`,
    `${resolvedPath}.js`,
    `${resolvedPath}.jsx`,
    join(resolvedPath, 'index.ts'),
    join(resolvedPath, 'index.tsx'),
    join(resolvedPath, 'index.js'),
    join(resolvedPath, 'index.jsx'),
  ];

  for (const candidatePath of candidatePaths) {
    const sourceFile = project.getSourceFile(candidatePath);
    if (sourceFile) return sourceFile;
  }

  return undefined;
}

function findWorkspacePackageEntrySourceFile(
  originSourceFile: SourceFile,
  moduleSpecifier: string,
): SourceFile | undefined {
  const project = originSourceFile.getProject();
  const candidateSourceFiles = project.getSourceFiles().filter((sourceFile) => {
    const manifest = getWorkspacePackageManifestForSourceFile(sourceFile);
    return manifest?.name === moduleSpecifier;
  });

  if (candidateSourceFiles.length === 0) return undefined;

  const packageRootDir = getWorkspacePackageManifestForSourceFile(candidateSourceFiles[0])?.rootDir;
  if (!packageRootDir) return undefined;

  const preferredEntryPaths = [
    join(packageRootDir, 'src/index.ts'),
    join(packageRootDir, 'src/index.tsx'),
    join(packageRootDir, 'index.ts'),
    join(packageRootDir, 'index.tsx'),
  ];

  for (const entryPath of preferredEntryPaths) {
    const entrySourceFile = project.getSourceFile(entryPath);
    if (entrySourceFile) {
      return entrySourceFile;
    }
  }

  return candidateSourceFiles.find((sourceFile) => sourceFile.getDirectoryPath() === join(packageRootDir, 'src'));
}

function getWorkspacePackageManifestForSourceFile(sourceFile: SourceFile): WorkspacePackageManifest | undefined {
  const packageRootDir = findNearestPackageRootDir(sourceFile.getFilePath());
  if (!packageRootDir) return undefined;

  if (workspacePackageManifestCache.has(packageRootDir)) {
    return workspacePackageManifestCache.get(packageRootDir) ?? undefined;
  }

  const packageJsonPath = join(packageRootDir, 'package.json');
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      name?: unknown;
    };
    const manifest = typeof packageJson.name === 'string' ? { name: packageJson.name, rootDir: packageRootDir } : null;
    workspacePackageManifestCache.set(packageRootDir, manifest);
    return manifest ?? undefined;
  } catch {
    workspacePackageManifestCache.set(packageRootDir, null);
    return undefined;
  }
}

function findNearestPackageRootDir(filePath: string): string | undefined {
  if (packageRootByFilePathCache.has(filePath)) {
    return packageRootByFilePathCache.get(filePath) ?? undefined;
  }

  let currentDir = dirname(filePath);
  while (true) {
    if (existsSync(join(currentDir, 'package.json'))) {
      packageRootByFilePathCache.set(filePath, currentDir);
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      packageRootByFilePathCache.set(filePath, null);
      return undefined;
    }

    currentDir = parentDir;
  }
}
