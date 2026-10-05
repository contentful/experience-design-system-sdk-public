import type { AstNode } from '../ast.js';

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

export function renderType(typeNode: AstNode | undefined): string {
  if (!typeNode) return 'unknown';
  switch (typeNode.type) {
    case 'TSStringKeyword':
      return 'string';
    case 'TSNumberKeyword':
      return 'number';
    case 'TSBooleanKeyword':
      return 'boolean';
    case 'TSAnyKeyword':
      return 'any';
    case 'TSUnknownKeyword':
      return 'unknown';
    case 'TSNullKeyword':
      return 'null';
    case 'TSUndefinedKeyword':
      return 'undefined';
    case 'TSVoidKeyword':
      return 'void';
    case 'TSArrayType': {
      return `${renderType(typeNode['elementType'] as AstNode)}[]`;
    }
    case 'TSTupleType': {
      const elements = (typeNode['elementTypes'] as AstNode[] | undefined) ?? [];
      const rendered = elements.map((el) => {
        if (el.type === 'TSNamedTupleMember') {
          const inner = el['elementType'] as AstNode | undefined;
          return renderType(inner);
        }
        return renderType(el);
      });
      return `[${rendered.join(', ')}]`;
    }
    case 'TSUnionType': {
      const members = (typeNode['types'] as AstNode[] | undefined) ?? [];
      return members.map(renderType).join(' | ');
    }
    case 'TSLiteralType': {
      const lit = typeNode['literal'] as AstNode | undefined;
      const v = lit?.['value'];
      if (typeof v === 'string') return `'${v}'`;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return 'unknown';
    }
    case 'TSTypeReference': {
      const tn = (typeNode['typeName'] as AstNode | undefined)?.['name'] as string | undefined;
      const args = typeNode['typeArguments'] as AstNode | undefined;
      const base = tn ?? 'unknown';
      const params = (args?.['params'] as AstNode[] | undefined) ?? null;
      if (params && params.length > 0) {
        return `${base}<${params.map(renderType).join(', ')}>`;
      }
      return base;
    }
    case 'TSFunctionType': {
      const params = ((typeNode['params'] as AstNode[] | undefined) ?? []).map((p) => {
        const ann = (p['typeAnnotation'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;
        const pname = (p['name'] as string | undefined) ?? 'arg';
        return `${pname}: ${renderType(ann)}`;
      });
      const ret = (typeNode['returnType'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;
      return `(${params.join(', ')}) => ${renderType(ret)}`;
    }
    default:
      return 'unknown';
  }
}

export function renderLiteral(node: AstNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === 'Literal') {
    const v = node['value'];
    const raw = node['raw'];
    if (typeof v === 'string') return `'${v}'`;
    if (typeof raw === 'string') return raw;
    if (v === null) return 'null';
    return String(v);
  }
  if (node.type === 'Identifier') return (node['name'] as string) ?? undefined;
  if (node.type === 'ArrayExpression') {
    const els = (node['elements'] as AstNode[] | undefined) ?? [];
    return `[${els.map((e) => renderLiteral(e) ?? '').join(', ')}]`;
  }
  if (node.type === 'ObjectExpression') return '{}';
  return undefined;
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
