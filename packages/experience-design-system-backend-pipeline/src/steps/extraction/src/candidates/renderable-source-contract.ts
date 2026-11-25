import { Node } from 'ts-morph';
import { sourceLocation } from './source-location.js';
import type { SourceFactLocation, SourceTypeNode } from './types.js';

export function renderableSourceContract(
  syntax: Node | null,
): { contract: NonNullable<SourceTypeNode['renderContract']>; declarations: SourceFactLocation[] } | undefined {
  const pending = syntax ? [syntax] : [];
  const seen = new Set<Node>();
  const declarations: SourceFactLocation[] = [];
  while (pending.length && seen.size < 64) {
    const node = pending.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Node.isParenthesizedTypeNode(node)) {
      pending.push(node.getTypeNode());
      continue;
    }
    if (!Node.isTypeReference(node)) continue;
    const symbol = node.getTypeName().getSymbol();
    const resolved = symbol?.getAliasedSymbol() ?? symbol;
    for (const declaration of resolved?.getDeclarations() ?? []) {
      if (!Node.isTypeAliasDeclaration(declaration) && !Node.isInterfaceDeclaration(declaration)) continue;
      declarations.push(sourceLocation(declaration));
      const name = declaration.getName();
      const path = declaration.getSourceFile().getFilePath().replaceAll('\\', '/');
      if (['ReactNode', 'ReactElement'].includes(name) && /\/node_modules\/(?:@types\/react|react)\//.test(path))
        return {
          contract: {
            framework: 'react',
            exportName: name as 'ReactNode' | 'ReactElement',
            declaration: sourceLocation(declaration),
          },
          declarations,
        };
      if (Node.isTypeAliasDeclaration(declaration)) {
        const alias = declaration.getTypeNode();
        if (alias) pending.push(alias);
      }
    }
  }
  return undefined;
}
