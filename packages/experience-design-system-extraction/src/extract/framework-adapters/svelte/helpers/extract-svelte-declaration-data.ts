import { Node } from 'ts-morph';
import type { AstNode } from '../types/svelte-ast-node.js';

export function getSourceText(source: string, node: AstNode): string | null {
  const start = (node['start'] as number | undefined) ?? null;
  const end = (node['end'] as number | undefined) ?? null;
  if (start == null || end == null) return null;
  return source.slice(start, end);
}

export function getScriptText(source: string, script: AstNode | undefined): string | null {
  if (!script) return null;
  const content = script['content'] as AstNode | undefined;
  if (!content) return null;
  return getSourceText(source, content);
}

export function extractAllowedValuesFromType(type: import('ts-morph').Type): string[] | undefined {
  if (!type.isUnion()) return undefined;
  const out: string[] = [];
  for (const t of type.getUnionTypes()) {
    if (!t.isStringLiteral()) return undefined;
    out.push(t.getLiteralValueOrThrow() as string);
  }
  return out.length > 0 ? out : undefined;
}

export function readJsDocFromDeclaration(decl: import('ts-morph').Node): string | undefined {
  if (Node.isPropertySignature(decl) || Node.isInterfaceDeclaration(decl) || Node.isTypeAliasDeclaration(decl)) {
    const jsdocs = decl.getJsDocs();
    if (jsdocs.length > 0) return jsdocs[0]!.getDescription().trim() || undefined;
  }
  return undefined;
}

export function readDeclaredTypeNodeText(decl: import('ts-morph').Node): string | null {
  if (Node.isPropertySignature(decl)) return decl.getTypeNode()?.getText() ?? null;
  return null;
}

export function typeRefersToSnippet(propType: import('ts-morph').Type): boolean {
  type TsMorphType = import('ts-morph').Type;
  const seen = new Set<TsMorphType>();
  let cursor: TsMorphType | undefined = propType;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const aliasName = cursor.getAliasSymbol()?.getName();
    const symName = cursor.getSymbol()?.getName();
    if (aliasName === 'Snippet' || symName === 'Snippet') {
      const decl = cursor.getAliasSymbol()?.getDeclarations()[0] ?? cursor.getSymbol()?.getDeclarations()[0];
      const file = decl?.getSourceFile().getFilePath() ?? '';
      if (file.includes('/svelte/') || file.includes('\\svelte\\') || file === '') return true;
    }
    if (cursor.isUnion()) {
      const nonUndef: TsMorphType[] = cursor.getUnionTypes().filter((t) => !t.isUndefined() && !t.isNull());
      if (nonUndef.length === 1) { cursor = nonUndef[0]; continue; }
    }
    break;
  }
  return false;
}
