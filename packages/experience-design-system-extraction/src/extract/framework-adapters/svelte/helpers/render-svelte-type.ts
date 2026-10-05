import type { AstNode } from '../types/svelte-ast-node.js';
export { renderType, renderLiteral } from './render-svelte-type-strings.js';

interface Comment {
  type: 'Line' | 'Block';
  value: string;
}

export function isSnippetTypeText(typeText: string, snippetLocals: Set<string>): boolean {
  for (const local of snippetLocals) {
    if (typeText === local || typeText.startsWith(`${local}<`)) return true;
  }
  return typeText === 'Snippet' || typeText.startsWith('Snippet<');
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
  const parts = typeText.split('|').map((p) => p.trim()).filter(Boolean);
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
  const text = last.value.split('\n').map((l) => l.replace(/^\s*\*\s?/, '').trim()).filter(Boolean).join(' ').trim();
  return text || undefined;
}
