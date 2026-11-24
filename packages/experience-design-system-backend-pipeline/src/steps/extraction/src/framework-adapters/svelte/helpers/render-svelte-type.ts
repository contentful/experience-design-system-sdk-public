import type { AstNode } from '../types/svelte-ast-node.js';
import ts from 'typescript';
export { renderType, renderLiteral } from './render-svelte-type-strings.js';

interface Comment {
  type: 'Line' | 'Block';
  value: string;
}

export function isSnippetTypeText(typeText: string, snippetLocals: Set<string>): boolean {
  if (!snippetLocals.size) return false;
  const source = ts.createSourceFile('input-type.ts', `type Input = ${typeText};`, ts.ScriptTarget.Latest, true);
  if (
    (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length ||
    source.statements.length !== 1
  )
    return false;
  const declaration = source.statements[0]!;
  if (!ts.isTypeAliasDeclaration(declaration)) return false;
  let type = declaration.type;
  while (ts.isParenthesizedTypeNode(type)) type = type.type;
  return ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && snippetLocals.has(type.typeName.text);
}

export function isSnippetType(typeNode: AstNode | undefined, snippetLocals: Set<string>): boolean {
  if (!typeNode) return false;
  if (typeNode.type !== 'TSTypeReference') return false;
  const tn = (typeNode['typeName'] as AstNode | undefined)?.['name'] as string | undefined;
  if (!tn) return false;
  return snippetLocals.has(tn);
}

export function collectStringLiteralUnion(typeNode: AstNode | undefined): string[] | undefined {
  if (!typeNode) return undefined;
  if (typeNode.type !== 'TSUnionType') return undefined;
  const members = typeNode['types'] as AstNode[] | undefined;
  if (!members) return undefined;
  const out: string[] = [];
  for (const m of members) {
    if (m.type !== 'TSLiteralType') return undefined;
    const lit = m['literal'] as AstNode | undefined;
    const v = lit?.['value'];
    if (typeof v !== 'string') return undefined;
    out.push(v);
  }
  return out.length > 0 ? out : undefined;
}

export function extractAllowedValuesFromText(typeText: string): string[] | undefined {
  const parts = typeText
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return undefined;
  const out: string[] = [];
  for (const p of parts) {
    const m = p.match(/^'([^']*)'$/) ?? p.match(/^"([^"]*)"$/);
    if (!m) return undefined;
    out.push(m[1]!);
  }
  return out.length > 0 ? out : undefined;
}

export function extractJsdocText(comments: Comment[]): string | undefined {
  if (!comments.length) return undefined;
  const last = comments[comments.length - 1]!;
  if (last.type !== 'Block') return undefined;
  const text = last.value
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  return text || undefined;
}
