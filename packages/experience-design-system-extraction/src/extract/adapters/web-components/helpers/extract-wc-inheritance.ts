import { Node, SyntaxKind, type ClassDeclaration, type Project } from 'ts-morph';
import type { RawPropDefinition, RawSlotDefinition } from '../../../model/component.js';
import {
  extractAccessorProperties,
  extractClassProperties,
  extractJsDocAttributeProps,
  hasShoelaceRuntimeBookkeepingField,
  mergePropLists,
} from '../properties.js';
import { resolveImportSourcePath } from './resolve-wc-import.js';
import { mergeSlotLists, extractJsDocSlots } from './extract-wc-slots.js';

function getImportedBaseClass(
  classDecl: ClassDeclaration,
  project: Project,
  visitedFiles: Set<string>,
): ClassDeclaration | null {
  const extendsClause = classDecl
    .getHeritageClauses()
    .find((clause) => clause.getToken() === SyntaxKind.ExtendsKeyword);
  const typeNode = extendsClause?.getTypeNodes()[0];
  if (!typeNode) return null;

  const expression = typeNode.getExpression();
  if (!Node.isIdentifier(expression)) return null;
  const baseName = expression.getText();

  const importDecl = classDecl
    .getSourceFile()
    .getImportDeclarations()
    .find(
      (decl) =>
        decl.getNamedImports().some((namedImport) => namedImport.getName() === baseName) ||
        decl.getDefaultImport()?.getText() === baseName,
    );
  if (!importDecl) return null;

  const resolvedImportPath = resolveImportSourcePath(
    classDecl.getSourceFile().getFilePath(),
    importDecl.getModuleSpecifierValue(),
  );
  if (!resolvedImportPath || visitedFiles.has(resolvedImportPath)) {
    return null;
  }
  visitedFiles.add(resolvedImportPath);

  let sourceFile = project.getSourceFile(resolvedImportPath);
  if (!sourceFile) {
    try {
      sourceFile = project.addSourceFileAtPath(resolvedImportPath);
    } catch {
      return null;
    }
  }

  const directClass = sourceFile.getClass(baseName);
  if (directClass) {
    return directClass;
  }

  for (const exportDecl of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = exportDecl.getModuleSpecifierValue();
    if (!moduleSpecifier) continue;

    const reexportPath = resolveImportSourcePath(sourceFile.getFilePath(), moduleSpecifier);
    if (!reexportPath || visitedFiles.has(reexportPath)) continue;
    visitedFiles.add(reexportPath);

    let reexportFile = project.getSourceFile(reexportPath);
    if (!reexportFile) {
      try {
        reexportFile = project.addSourceFileAtPath(reexportPath);
      } catch {
        continue;
      }
    }

    const reexportedClass = reexportFile.getClass(baseName);
    if (reexportedClass) {
      return reexportedClass;
    }
  }

  return null;
}

export function extractInheritedClassProperties(
  classDecl: ClassDeclaration,
  project: Project,
  visitedFiles: Set<string> = new Set(),
  applyRuntimeFieldDenylist = false,
): RawPropDefinition[] {
  const baseClass = getImportedBaseClass(classDecl, project, visitedFiles);
  if (!baseClass) {
    return [];
  }

  const nextApplyRuntimeFieldDenylist = applyRuntimeFieldDenylist || hasShoelaceRuntimeBookkeepingField(baseClass);
  return mergePropLists(
    extractInheritedClassProperties(baseClass, project, visitedFiles, nextApplyRuntimeFieldDenylist),
    extractJsDocAttributeProps(baseClass),
    extractAccessorProperties(baseClass, nextApplyRuntimeFieldDenylist),
    extractClassProperties(baseClass, nextApplyRuntimeFieldDenylist),
  );
}

export function extractInheritedSlots(
  classDecl: ClassDeclaration,
  project: Project,
  visitedFiles: Set<string> = new Set(),
): RawSlotDefinition[] {
  const baseClass = getImportedBaseClass(classDecl, project, visitedFiles);
  if (!baseClass) {
    return [];
  }

  return mergeSlotLists(extractInheritedSlots(baseClass, project, visitedFiles), extractJsDocSlots(baseClass));
}

