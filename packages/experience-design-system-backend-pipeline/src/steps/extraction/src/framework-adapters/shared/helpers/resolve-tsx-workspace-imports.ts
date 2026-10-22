import { join } from 'node:path';
import { Node, type Project, type SourceFile } from 'ts-morph';
import {
  matchTsConfigPathPattern,
  substituteTsConfigPathTarget,
  resolveImportSourcePath,
  resolveRepoLocalAliasImportPath,
} from './resolve-tsx-tsconfig-path.js';
import { findWorkspacePackageEntrySourceFile } from './find-tsx-workspace-package.js';

export { matchTsConfigPathPattern, substituteTsConfigPathTarget };

export function isBareModuleSpecifier(moduleSpecifier: string): boolean {
  return !moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('/');
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

function findRepoLocalAliasSourceFile(originSourceFile: SourceFile, moduleSpecifier: string): SourceFile | undefined {
  const resolvedPath = resolveRepoLocalAliasImportPath(originSourceFile.getFilePath(), moduleSpecifier);
  if (!resolvedPath) return undefined;
  return findProjectSourceFileByImportPath(originSourceFile.getProject(), resolvedPath);
}

function getExportedDeclarationsForImportSpecifier(importSpecifier: Node, sourceFile: SourceFile): Node[] {
  if (!Node.isImportSpecifier(importSpecifier)) return [];
  const exportedName = importSpecifier.getNameNode().getText();
  return sourceFile.getExportedDeclarations().get(exportedName) ?? [];
}

export function resolveWorkspaceImportSpecifierDeclarations(importSpecifier: Node, referenceNode: Node): Node[] {
  if (!Node.isImportSpecifier(importSpecifier)) return [];
  const importDeclaration = importSpecifier.getImportDeclaration();
  const moduleSpecifierSourceFile = importDeclaration.getModuleSpecifierSourceFile();
  if (moduleSpecifierSourceFile)
    return getExportedDeclarationsForImportSpecifier(importSpecifier, moduleSpecifierSourceFile);
  const moduleSpecifier = importDeclaration.getModuleSpecifierValue();
  if (!isBareModuleSpecifier(moduleSpecifier)) return [];
  const workspaceEntrySourceFile = findWorkspacePackageEntrySourceFile(referenceNode.getSourceFile(), moduleSpecifier);
  if (workspaceEntrySourceFile)
    return getExportedDeclarationsForImportSpecifier(importSpecifier, workspaceEntrySourceFile);
  const aliasedSourceFile = findRepoLocalAliasSourceFile(referenceNode.getSourceFile(), moduleSpecifier);
  if (!aliasedSourceFile) return [];
  return getExportedDeclarationsForImportSpecifier(importSpecifier, aliasedSourceFile);
}

export { resolveImportSourcePath };
