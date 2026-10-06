import { dirname, resolve } from 'node:path';
import { Node, type Project, type SourceFile } from 'ts-morph';

export function loadSourceFile(project: Project, filePath: string): SourceFile | null {
  let sourceFile = project.getSourceFile(filePath);
  if (sourceFile) return sourceFile;
  try {
    sourceFile = project.addSourceFileAtPath(filePath);
    return sourceFile;
  } catch {
    return null;
  }
}

export function resolveImportSourcePath(fromFilePath: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    const resolvedPath = resolve(dirname(fromFilePath), specifier);
    if (resolvedPath.endsWith('.js')) return `${resolvedPath.slice(0, -3)}.ts`;
    return resolvedPath;
  }
  const spectrumPrefix = '@spectrum-web-components/core/components/';
  if (!specifier.startsWith(spectrumPrefix)) return null;
  const packagesMarker = `${'2nd-gen/packages'}${fromFilePath.includes('\\') ? '\\' : '/'}`;
  const markerIndex = fromFilePath.lastIndexOf(packagesMarker);
  if (markerIndex === -1) return null;
  const packagesRoot = fromFilePath.slice(0, markerIndex + packagesMarker.length - 1);
  const componentPath = specifier.slice(spectrumPrefix.length);
  return `${packagesRoot}/core/components/${componentPath}/index.ts`;
}

export function resolveImportSpecifierSource(
  declarationNode: Node,
  sourceFile: SourceFile,
  project: Project,
): { sourceFile: SourceFile; importedName: string } | undefined {
  if (!Node.isImportSpecifier(declarationNode)) return undefined;
  const importDecl = declarationNode.getImportDeclaration();
  const resolvedImportPath = resolveImportSourcePath(sourceFile.getFilePath(), importDecl.getModuleSpecifierValue());
  if (!resolvedImportPath) return undefined;
  const importedFile = loadSourceFile(project, resolvedImportPath);
  if (!importedFile) return undefined;
  return {
    sourceFile: importedFile,
    importedName: declarationNode.getNameNode().getText(),
  };
}
