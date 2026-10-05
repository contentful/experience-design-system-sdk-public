import type { AstNode } from '../ast.js';
import { isSnippetType, renderType, collectStringLiteralUnion, extractJsdocText } from './render-svelte-type.js';

export interface ResolvedTypeMember {
  name: string;
  optional: boolean;
  typeText: string;
  declaredTypeText?: string;
  isSnippet: boolean;
  allowedValues?: string[];
  description?: string;
  line?: number;
  endLine?: number;
}

interface Comment {
  type: 'Line' | 'Block';
  value: string;
}

export function readPropertySignature(member: AstNode, snippetLocals: Set<string>): ResolvedTypeMember | null {
  if (member.type !== 'TSPropertySignature') return null;
  const key = member['key'] as AstNode | undefined;
  const name = (key?.['name'] as string | undefined) ?? null;
  if (!name) return null;
  const optional = !!member['optional'];
  const typeNode = (member['typeAnnotation'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;
  const typeText = renderType(typeNode);
  const isSnippet = isSnippetType(typeNode, snippetLocals);
  const allowedValues = collectStringLiteralUnion(typeNode);
  const leading = (member['leadingComments'] as Comment[] | undefined) ?? [];
  const description = extractJsdocText(leading);
  return { name, optional, typeText, isSnippet, allowedValues, description, line: member.loc?.start?.line, endLine: member.loc?.end?.line };
}

export function readMembersFromTypeLiteral(literal: AstNode, snippetLocals: Set<string>): ResolvedTypeMember[] {
  const members = literal['members'] as AstNode[] | undefined;
  if (!members) return [];
  return members.map((m) => readPropertySignature(m, snippetLocals)).filter((m): m is ResolvedTypeMember => !!m);
}

export function readMembersFromInterfaceOrAlias(decl: AstNode, snippetLocals: Set<string>): ResolvedTypeMember[] {
  if (decl.type === 'TSInterfaceDeclaration') {
    const body = (decl['body'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
    if (!body) return [];
    return body.map((m) => readPropertySignature(m, snippetLocals)).filter((m): m is ResolvedTypeMember => !!m);
  }
  if (decl.type === 'TSTypeAliasDeclaration') {
    const ann = decl['typeAnnotation'] as AstNode | undefined;
    if (ann?.type === 'TSTypeLiteral') return readMembersFromTypeLiteral(ann, snippetLocals);
  }
  return [];
}
