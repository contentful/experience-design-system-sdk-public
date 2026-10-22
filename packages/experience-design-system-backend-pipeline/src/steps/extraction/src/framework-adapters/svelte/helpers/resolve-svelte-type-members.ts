import type { AstNode } from '../types/svelte-ast-node.js';
import {
  collectSnippetImportLocals,
  findLocalTypeDeclaration,
  declarationHasHeritage,
  mergeSets,
} from './find-svelte-script-declarations.js';
import {
  type ResolvedTypeMember,
  readMembersFromTypeLiteral,
  readMembersFromInterfaceOrAlias,
} from './extract-svelte-ast-type-members.js';
import { resolveViaTypeChecker } from './resolve-svelte-type-checker.js';
import { resolveImportedTypeMembers } from './resolve-svelte-external-type-readers.js';

export type { ResolvedTypeMember };
export {
  readPropertySignature,
  readMembersFromTypeLiteral,
  readMembersFromInterfaceOrAlias,
} from './extract-svelte-ast-type-members.js';
export { resolveViaTypeChecker } from './resolve-svelte-type-checker.js';

export async function resolveTypeMembers(
  annotation: AstNode,
  instance: AstNode,
  moduleScript: AstNode | undefined,
  filePath: string,
  source: string,
): Promise<ResolvedTypeMember[] | null> {
  const snippetLocals = mergeSets(
    collectSnippetImportLocals(instance),
    moduleScript ? collectSnippetImportLocals(moduleScript) : new Set<string>(),
  );

  if (annotation.type === 'TSTypeLiteral') {
    return readMembersFromTypeLiteral(annotation, snippetLocals);
  }

  if (annotation.type === 'TSTypeReference') {
    const refName = ((annotation['typeName'] as AstNode | undefined)?.['name'] as string | undefined) ?? null;
    if (refName) {
      const local = findLocalTypeDeclaration(instance, refName, moduleScript);
      if (local) {
        const fastPathMembers = readMembersFromInterfaceOrAlias(local, snippetLocals);
        if (fastPathMembers.length > 0 && !declarationHasHeritage(local)) return fastPathMembers;
      } else {
        const imported =
          (await resolveImportedTypeMembers(refName, instance, filePath)) ??
          (moduleScript ? await resolveImportedTypeMembers(refName, moduleScript, filePath) : null);
        if (imported) return imported;
      }
    }
  }

  return resolveViaTypeChecker(annotation, instance, moduleScript, filePath, source, snippetLocals);
}
