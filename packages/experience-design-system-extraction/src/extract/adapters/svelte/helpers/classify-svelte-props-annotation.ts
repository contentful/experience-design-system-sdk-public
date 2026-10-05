import type { AstNode } from '../ast.js';
import { findLocalTypeDeclaration, declarationHasHeritage } from './find-svelte-script-declarations.js';
import type { ResolvedTypeMember } from './resolve-svelte-type-members.js';

export function formatAnnotation(annotation: AstNode | undefined): string {
  if (!annotation) return '<unknown>';
  if (annotation.type === 'TSTypeReference') {
    const name = ((annotation['typeName'] as AstNode | undefined)?.['name'] as string | undefined) ?? null;
    return name ? `'${name}'` : '<unnamed reference>';
  }
  if (annotation.type === 'TSIntersectionType') return '<intersection>';
  if (annotation.type === 'TSUnionType') return '<union>';
  if (annotation.type === 'TSTypeLiteral') return '<inline literal>';
  return `<${annotation.type}>`;
}

export function classifyUnresolved(
  annotation: AstNode | undefined,
  members: ResolvedTypeMember[] | null,
  instance: AstNode,
  moduleScript: AstNode | undefined,
): 'empty' | 'partial-heritage' | null {
  if (!annotation) return null;
  if (annotation.type === 'TSTypeLiteral') {
    const litMembers = (annotation['members'] as AstNode[] | undefined) ?? [];
    if (litMembers.length === 0) return null;
  }
  if (members === null || members.length === 0) return 'empty';

  if (annotation.type === 'TSTypeReference') {
    const refName = ((annotation['typeName'] as AstNode | undefined)?.['name'] as string | undefined) ?? null;
    if (refName) {
      const decl = findLocalTypeDeclaration(instance, refName, moduleScript);
      if (decl && declarationHasHeritage(decl) && members.every((m) => m.isSnippet)) {
        return 'partial-heritage';
      }
    }
  }
  return null;
}

export function getPropsTypeName(propsCall: AstNode): string | undefined {
  const id = propsCall['id'] as AstNode | undefined;
  const annotation = (id?.['typeAnnotation'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;
  if (annotation?.type === 'TSTypeReference') {
    const tn = (annotation['typeName'] as AstNode | undefined)?.['name'] as string | undefined;
    if (tn && /^[A-Za-z_$][\w$]*$/.test(tn)) return tn;
  }
  return undefined;
}

export function getRetryAnnotation(propsCall: AstNode): AstNode | undefined {
  const id = propsCall['id'] as AstNode | undefined;
  return (id?.['typeAnnotation'] as AstNode | undefined)?.['typeAnnotation'] as AstNode | undefined;
}
