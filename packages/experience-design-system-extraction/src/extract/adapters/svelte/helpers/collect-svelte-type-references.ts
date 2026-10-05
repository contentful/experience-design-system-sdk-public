import type { AstNode } from '../ast.js';

export function collectReferencedTypeNames(node: AstNode): Set<string> {
  const names = new Set<string>();
  walk(node);
  return names;

  function walk(n: AstNode | undefined) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'TSTypeReference') {
      const tn = (n['typeName'] as AstNode | undefined)?.['name'] as string | undefined;
      if (tn) names.add(tn);
    }
    if (n.type === 'TSExpressionWithTypeArguments') {
      const exprName = (n['expression'] as AstNode | undefined)?.['name'] as string | undefined;
      if (exprName) names.add(exprName);
    }
    for (const value of Object.values(n)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          if (v && typeof v === 'object') walk(v as AstNode);
        }
      } else if (value && typeof value === 'object' && (value as AstNode).type) {
        walk(value as AstNode);
      }
    }
  }
}

export function collectImportSpecifiersForNames(script: AstNode, names: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  const body = (script['content'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
  if (!body) return out;
  for (const stmt of body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const specifierValue = (stmt['source'] as AstNode | undefined)?.['value'] as string | undefined;
    if (!specifierValue) continue;
    const specifiers = (stmt['specifiers'] as AstNode[] | undefined) ?? [];
    for (const spec of specifiers) {
      if (spec.type !== 'ImportSpecifier' && spec.type !== 'ImportDefaultSpecifier') continue;
      const localName = (spec['local'] as AstNode | undefined)?.['name'] as string | undefined;
      if (localName && names.has(localName)) out.set(localName, specifierValue);
    }
  }
  return out;
}
