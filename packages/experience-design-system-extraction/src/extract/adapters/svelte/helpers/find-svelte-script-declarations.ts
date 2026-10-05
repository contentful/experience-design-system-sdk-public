import type { AstNode } from '../ast.js';

export { collectReferencedTypeNames, collectImportSpecifiersForNames } from './collect-svelte-type-references.js';

export function hasV4ExportLetProps(instance: AstNode): boolean {
  const body = (instance['content'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
  if (!body) return false;
  return body.some((stmt) => {
    if (stmt.type !== 'ExportNamedDeclaration') return false;
    const decl = stmt['declaration'] as AstNode | undefined;
    return decl?.type === 'VariableDeclaration' && decl['kind'] === 'let';
  });
}

export function findPropsCall(instance: AstNode): AstNode | null {
  const body = (instance['content'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
  if (!body) return null;
  let found: AstNode | null = null;
  for (const stmt of body) {
    if (stmt.type !== 'VariableDeclaration') continue;
    const decls = stmt['declarations'] as AstNode[] | undefined;
    if (!decls) continue;
    for (const d of decls) {
      const init = d['init'] as AstNode | undefined;
      if (!init || init.type !== 'CallExpression') continue;
      const callee = init['callee'] as AstNode | undefined;
      if (callee?.type === 'Identifier' && callee['name'] === '$props') {
        if (found === null) found = d;
      }
    }
  }
  return found;
}

export function collectSnippetImportLocals(instance: AstNode): Set<string> {
  const locals = new Set<string>();
  const body = (instance['content'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
  if (!body) return locals;
  for (const stmt of body) {
    if (stmt.type !== 'ImportDeclaration') continue;
    const sourceNode = stmt['source'] as AstNode | undefined;
    if (sourceNode?.['value'] !== 'svelte') continue;
    const specs = stmt['specifiers'] as AstNode[] | undefined;
    if (!specs) continue;
    for (const spec of specs) {
      if (spec.type !== 'ImportSpecifier') continue;
      const imported = spec['imported'] as AstNode | undefined;
      const local = spec['local'] as AstNode | undefined;
      if (imported?.['name'] === 'Snippet' && typeof local?.['name'] === 'string') {
        locals.add(local['name'] as string);
      }
    }
  }
  return locals;
}

export function findLocalTypeDeclaration(instance: AstNode, name: string, module?: AstNode): AstNode | null {
  for (const script of [instance, module]) {
    const body = (script?.['content'] as AstNode | undefined)?.['body'] as AstNode[] | undefined;
    if (!body) continue;
    for (const stmt of body) {
      const decl =
        stmt.type === 'ExportNamedDeclaration' ? ((stmt['declaration'] as AstNode | undefined) ?? stmt) : stmt;
      if (decl.type === 'TSInterfaceDeclaration' || decl.type === 'TSTypeAliasDeclaration') {
        const id = decl['id'] as AstNode | undefined;
        if (id?.['name'] === name) return decl;
      }
    }
  }
  return null;
}

export function declarationHasHeritage(decl: AstNode): boolean {
  if (decl.type === 'TSInterfaceDeclaration') {
    const ext = decl['extends'] as AstNode[] | undefined;
    return Array.isArray(ext) && ext.length > 0;
  }
  return false;
}

export function mergeSets<T>(a: Set<T>, b: Set<T>): Set<T> {
  const out = new Set<T>(a);
  for (const v of b) out.add(v);
  return out;
}
