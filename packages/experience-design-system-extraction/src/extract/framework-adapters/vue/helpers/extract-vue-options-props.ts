import { resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { Node, Project } from 'ts-morph';
import type { RawPropDefinition } from '../../../types/component.js';
import { resolveWorkspaceVueImport } from './resolve-workspace-module.js';
import { parseVueObjectProps } from './extract-vue-object-props.js';

export { isPublicVuePropName, parseVueObjectProps } from './extract-vue-object-props.js';

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
          for (const prop of await extractInheritedVueProps(extendsPath, visited)) mergedProps.set(prop.name, prop);
        }
      }
    }

    const propsProp = expr.getProperty('props');
    if (!propsProp || !Node.isPropertyAssignment(propsProp)) return [...mergedProps.values()].sort((a, b) => a.name.localeCompare(b.name));
    const propsInit = propsProp.getInitializer();
    if (!propsInit || !Node.isObjectLiteralExpression(propsInit)) return [...mergedProps.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const prop of parseVueObjectProps(propsInit)) mergedProps.set(prop.name, prop);
    return [...mergedProps.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  return [];
}

export async function extractInheritedVueProps(filePath: string, visited: Set<string>): Promise<RawPropDefinition[]> {
  const source = await readFile(filePath, 'utf-8');
  const { descriptor } = parseSFC(source);
  if (!descriptor.script) return [];
  return extractVueOptionsProps(filePath, descriptor.script.content, visited);
}
