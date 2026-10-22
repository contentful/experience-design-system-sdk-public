import { readFile } from 'node:fs/promises';
import { Project, Node } from 'ts-morph';
import type { RawPropDefinition } from '../../../types/component.js';
import { resolveLocalModule } from '../../shared/helpers/resolve-import-file-path.js';
import { parseVueObjectProps } from './extract-vue-object-props.js';

type SetupImportedObjectRef = { filePath: string; exportName: string };

export function collectSetupImportedObjectRefs(
  sf: import('ts-morph').SourceFile,
  filePath: string,
): Map<string, SetupImportedObjectRef> {
  const refs = new Map<string, SetupImportedObjectRef>();
  for (const importDecl of sf.getImportDeclarations()) {
    const specifier = importDecl.getModuleSpecifierValue();
    if (!specifier.startsWith('.')) continue;
    const resolvedImportPath = resolveLocalModule(filePath, specifier);
    if (!resolvedImportPath) continue;
    for (const namedImport of importDecl.getNamedImports()) {
      refs.set(namedImport.getAliasNode()?.getText() ?? namedImport.getName(), {
        filePath: resolvedImportPath,
        exportName: namedImport.getName(),
      });
    }
  }
  return refs;
}

async function extractImportedObjectExportProps(
  importedRef: SetupImportedObjectRef,
  visitedImports: Set<string>,
): Promise<RawPropDefinition[]> {
  const visitKey = `${importedRef.filePath}:${importedRef.exportName}`;
  if (visitedImports.has(visitKey)) return [];
  visitedImports.add(visitKey);

  const source = await readFile(importedRef.filePath, 'utf-8');
  const project = new Project({
    compilerOptions: { strict: false, target: 99, module: 99, allowJs: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });

  const sf = project.createSourceFile('__imported_object__.ts', source);
  for (const declaration of sf.getVariableDeclarations()) {
    if (declaration.getName() !== importedRef.exportName) continue;
    const initializer = declaration.getInitializer();
    if (!initializer || !Node.isObjectLiteralExpression(initializer)) continue;
    return parseVueObjectProps(initializer);
  }
  return [];
}

export async function mergeSetupObjectProps(
  obj: import('ts-morph').ObjectLiteralExpression,
  importedObjectRefs: Map<string, SetupImportedObjectRef>,
  visitedImports: Set<string>,
): Promise<RawPropDefinition[]> {
  const mergedProps = new Map<string, RawPropDefinition>();
  for (const prop of parseVueObjectProps(obj)) mergedProps.set(prop.name, prop);
  for (const prop of obj.getProperties()) {
    if (!Node.isSpreadAssignment(prop)) continue;
    const expression = prop.getExpression();
    if (!Node.isIdentifier(expression)) continue;
    const importedRef = importedObjectRefs.get(expression.getText());
    if (!importedRef) continue;
    for (const importedProp of await extractImportedObjectExportProps(importedRef, visitedImports)) {
      if (!mergedProps.has(importedProp.name)) mergedProps.set(importedProp.name, importedProp);
    }
  }
  return [...mergedProps.values()].sort((a, b) => a.name.localeCompare(b.name));
}
