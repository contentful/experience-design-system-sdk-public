import { Node, type SourceFile } from 'ts-morph';
import type { ExtractionExclusion } from '../../model/component.js';

export function resolveDefaultExportName(
  declarations: Node[],
  exported: { has(name: string): boolean },
  allowVariableDeclaration = false,
): string | undefined {
  const declaration = declarations[0];
  const name = Node.isFunctionDeclaration(declaration)
    ? declaration.getName()
    : allowVariableDeclaration && Node.isVariableDeclaration(declaration)
      ? declaration.getName()
      : undefined;

  if (!name || !/^[A-Z]/.test(name) || exported.has(name)) return undefined;
  return name;
}

export function getRenderableExports(
  sourceFile: SourceFile,
  exclusions: ExtractionExclusion[],
  options: { allowVariableDeclaration?: boolean; hookReason: string },
): Array<{ name: string; declarations: Node[] }> {
  const renderable: Array<{ name: string; declarations: Node[] }> = [];
  const exported = sourceFile.getExportedDeclarations();

  for (const [exportKey, declarations] of exported) {
    const name =
      exportKey === 'default'
        ? resolveDefaultExportName(declarations, exported, options.allowVariableDeclaration)
        : exportKey;
    if (!name || !/^[A-Z]/.test(name)) continue;
    if (name.startsWith('use')) {
      exclusions.push({
        itemType: 'component',
        name,
        source: sourceFile.getFilePath(),
        reason: options.hookReason,
        stage: 'component-filter',
      });
      continue;
    }
    renderable.push({ name, declarations });
  }

  return renderable;
}
