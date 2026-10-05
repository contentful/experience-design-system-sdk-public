import { readFile } from 'node:fs/promises';
import { Project, Node } from 'ts-morph';
import type { RawPropDefinition } from '../../../model/component.js';
import { resolveLocalModule } from '../../support/resolution/local-module.js';
import { resolveTypeProperty } from '../../support/resolution/type-property.js';
import { parseVueObjectProps } from './extract-vue-options-props.js';

type SetupImportedObjectRef = { filePath: string; exportName: string };

/** Extracts props from a `<script setup>` block; returns null when no defineProps is found. */
export async function extractVueSetupProps(
  filePath: string,
  scriptSetupContent: string,
): Promise<RawPropDefinition[] | null> {
  const project = new Project({
    compilerOptions: { strict: false, target: 99, module: 99, allowJs: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });

  const sf = project.createSourceFile('__setup__.ts', scriptSetupContent);

  // Try generic syntax: defineProps<{...}>()
  let genericTypeText: string | null = null;
  sf.forEachDescendant((node) => {
    if (genericTypeText !== null) return;
    if (
      Node.isCallExpression(node) &&
      node.getExpression().getText() === 'defineProps' &&
      node.getTypeArguments().length > 0
    ) {
      genericTypeText = node.getTypeArguments()[0].getText();
    }
  });

  if (genericTypeText !== null) {
    return extractGenericSetupProps(genericTypeText);
  }

  const importedObjectRefs = collectSetupImportedObjectRefs(sf, filePath);

  // Try object syntax: defineProps({...})
  let objectProps: RawPropDefinition[] | null = null;
  const visitedImports = new Set<string>();
  for (const node of sf.getDescendants()) {
    if (objectProps !== null) break;
    if (
      Node.isCallExpression(node) &&
      node.getExpression().getText() === 'defineProps' &&
      node.getTypeArguments().length === 0
    ) {
      const args = node.getArguments();
      if (args.length > 0 && Node.isObjectLiteralExpression(args[0])) {
        objectProps = await mergeSetupObjectProps(args[0], importedObjectRefs, visitedImports);
      }
    }
  }

  return objectProps;
}

function extractGenericSetupProps(typeText: string): RawPropDefinition[] {
  const project = new Project({
    compilerOptions: { strict: true, target: 99, module: 99 },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });

  const sf = project.createSourceFile('__props__.ts', `type __Props__ = ${typeText};`);
  const typeAlias = sf.getTypeAlias('__Props__');
  if (!typeAlias) return [];

  const props: RawPropDefinition[] = [];
  for (const property of typeAlias.getType().getProperties()) {
    const resolved = resolveTypeProperty(property);
    if (!resolved) continue;

    let { typeText: resolvedTypeText } = resolved;
    if (!resolved.required) {
      resolvedTypeText = resolvedTypeText
        .replace(/\s*\|\s*undefined$/, '')
        .replace(/^undefined\s*\|\s*/, '');
    }

    props.push({ name: resolved.name, type: resolvedTypeText, required: resolved.required });
  }

  return props.sort((a, b) => a.name.localeCompare(b.name));
}

function collectSetupImportedObjectRefs(
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

async function mergeSetupObjectProps(
  obj: import('ts-morph').ObjectLiteralExpression,
  importedObjectRefs: Map<string, SetupImportedObjectRef>,
  visitedImports: Set<string>,
): Promise<RawPropDefinition[]> {
  const mergedProps = new Map<string, RawPropDefinition>();

  for (const prop of parseVueObjectProps(obj)) {
    mergedProps.set(prop.name, prop);
  }

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
