import { resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { Project, Node } from 'ts-morph';
import type { RawPropDefinition } from '../../../model/component.js';
import { resolveWorkspaceVueImport } from './resolve-workspace-module.js';

const VUE_TYPE_MAP: Record<string, string> = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Array: 'any[]',
  Object: 'object',
  Function: 'function',
  Date: 'Date',
  Symbol: 'symbol',
};

/** Returns true when the prop name is not prefixed with `_` or `$` (which marks private/internal props). */
export function isPublicVuePropName(name: string): boolean {
  return !/^[_$]/.test(name);
}

/** Parses an object literal props definition (Options API) into RawPropDefinitions. */
export function parseVueObjectProps(obj: import('ts-morph').ObjectLiteralExpression): RawPropDefinition[] {
  if (!Node.isObjectLiteralExpression(obj)) return [];

  const result: RawPropDefinition[] = [];

  for (const prop of obj.getProperties()) {
    if (!Node.isPropertyAssignment(prop)) continue;

    const name = prop.getName();
    if (!isPublicVuePropName(name)) continue;
    const init = prop.getInitializer();

    if (!init || !Node.isObjectLiteralExpression(init)) {
      result.push({
        name,
        type: VUE_TYPE_MAP[init?.getText() ?? ''] ?? 'any',
        required: false,
        sourceStartLine: prop.getStartLineNumber(),
        sourceEndLine: prop.getEndLineNumber(),
      });
      continue;
    }

    const typeProp = init.getProperty('type');
    const requiredProp = init.getProperty('required');
    const defaultProp = init.getProperty('default');

    let type = 'any';
    if (typeProp && Node.isPropertyAssignment(typeProp)) {
      const typeInit = typeProp.getInitializer();
      if (typeInit) type = VUE_TYPE_MAP[typeInit.getText()] ?? 'any';
    }

    let required = false;
    if (requiredProp && Node.isPropertyAssignment(requiredProp)) {
      const reqInit = requiredProp.getInitializer();
      if (reqInit) required = reqInit.getText() === 'true';
    }

    let defaultValue: string | undefined;
    if (defaultProp && Node.isPropertyAssignment(defaultProp)) {
      const defInit = defaultProp.getInitializer();
      if (defInit) defaultValue = defInit.getText().replace(/^['"]|['"]$/g, '');
    }

    result.push({
      name,
      type,
      required,
      ...(defaultValue !== undefined && { defaultValue }),
      sourceStartLine: prop.getStartLineNumber(),
      sourceEndLine: prop.getEndLineNumber(),
    });
  }

  return result;
}

export async function extractVueOptionsProps(
  filePath: string,
  scriptContent: string,
  visited: Set<string> = new Set(),
): Promise<RawPropDefinition[]> {
  const resolvedFilePath = resolve(filePath);
  if (visited.has(resolvedFilePath)) return [];
  visited.add(resolvedFilePath);

  const project = new Project({
    compilerOptions: { strict: false, target: 99, module: 99, allowJs: true },
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
  });

  const sf = project.createSourceFile('__options__.ts', scriptContent);
  const localImports = new Map<string, string>();

  for (const importDecl of sf.getImportDeclarations()) {
    const specifier = importDecl.getModuleSpecifierValue();
    const defaultImport = importDecl.getDefaultImport();
    if (!defaultImport) continue;

    if (specifier.startsWith('.')) {
      if (!specifier.endsWith('.vue')) continue;
      localImports.set(defaultImport.getText(), resolve(dirname(resolvedFilePath), specifier));
    } else {
      const resolvedVuePath = resolveWorkspaceVueImport(specifier, resolvedFilePath);
      if (resolvedVuePath) localImports.set(defaultImport.getText(), resolvedVuePath);
    }
  }

  for (const node of sf.getDescendants()) {
    if (!Node.isExportAssignment(node)) continue;
    const expr = node.getExpression();
    if (!Node.isObjectLiteralExpression(expr)) continue;

    const mergedProps = new Map<string, RawPropDefinition>();

    const extendsProp = expr.getProperty('extends');
    if (extendsProp && Node.isPropertyAssignment(extendsProp)) {
      const extendsInit = extendsProp.getInitializer();
      if (extendsInit && Node.isIdentifier(extendsInit)) {
        const extendsPath = localImports.get(extendsInit.getText());
        if (extendsPath) {
          for (const prop of await extractInheritedVueProps(extendsPath, visited)) {
            mergedProps.set(prop.name, prop);
          }
        }
      }
    }

    const propsProp = expr.getProperty('props');
    if (!propsProp || !Node.isPropertyAssignment(propsProp)) {
      return [...mergedProps.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    const propsInit = propsProp.getInitializer();
    if (!propsInit || !Node.isObjectLiteralExpression(propsInit)) {
      return [...mergedProps.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    for (const prop of parseVueObjectProps(propsInit)) {
      mergedProps.set(prop.name, prop);
    }

    return [...mergedProps.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  return [];
}

export async function extractInheritedVueProps(
  filePath: string,
  visited: Set<string>,
): Promise<RawPropDefinition[]> {
  const source = await readFile(filePath, 'utf-8');
  const { descriptor } = parseSFC(source);
  if (!descriptor.script) return [];
  return extractVueOptionsProps(filePath, descriptor.script.content, visited);
}
