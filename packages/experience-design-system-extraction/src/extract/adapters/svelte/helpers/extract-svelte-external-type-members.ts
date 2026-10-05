import { Node } from 'ts-morph';
import { isSnippetTypeText, extractAllowedValuesFromText } from './render-svelte-type.js';
import type { ResolvedTypeMember } from './extract-svelte-ast-type-members.js';

export function collectSnippetLocalsFromSourceFile(sf: import('ts-morph').SourceFile): Set<string> {
  const locals = new Set<string>();
  for (const importDecl of sf.getImportDeclarations()) {
    if (importDecl.getModuleSpecifierValue() !== 'svelte') continue;
    for (const named of importDecl.getNamedImports()) {
      if (named.getName() === 'Snippet') {
        const aliasNode = named.getAliasNode();
        locals.add(aliasNode ? aliasNode.getText() : named.getName());
      }
    }
  }
  return locals;
}

export function readInterfaceMembers(
  iface: import('ts-morph').InterfaceDeclaration,
  snippetLocals: Set<string>,
): ResolvedTypeMember[] {
  return iface.getProperties().map((prop) => {
    const typeNode = prop.getTypeNode();
    const typeText = typeNode ? typeNode.getText() : prop.getType().getText(prop);
    const allowed = extractAllowedValuesFromText(typeText);
    const jsdocs = prop.getJsDocs();
    const description = jsdocs.length > 0 ? jsdocs[0]!.getDescription().trim() : undefined;
    return {
      name: prop.getName(),
      optional: prop.hasQuestionToken(),
      typeText,
      isSnippet: isSnippetTypeText(typeText, snippetLocals),
      ...(allowed ? { allowedValues: allowed } : {}),
      ...(description ? { description } : {}),
      line: prop.getStartLineNumber(),
      endLine: prop.getEndLineNumber(),
    } satisfies ResolvedTypeMember;
  });
}

export function readTypeLiteralMembers(
  typeNode: import('ts-morph').TypeLiteralNode,
  snippetLocals: Set<string>,
): ResolvedTypeMember[] {
  return typeNode.getMembers().flatMap((m) => {
    if (!Node.isPropertySignature(m)) return [];
    const tn = m.getTypeNode();
    const typeText = tn ? tn.getText() : 'unknown';
    const allowed = extractAllowedValuesFromText(typeText);
    const jsdocs = m.getJsDocs();
    const description = jsdocs.length > 0 ? jsdocs[0]!.getDescription().trim() : undefined;
    return [{
      name: m.getName(),
      optional: m.hasQuestionToken(),
      typeText,
      isSnippet: isSnippetTypeText(typeText, snippetLocals),
      ...(allowed ? { allowedValues: allowed } : {}),
      ...(description ? { description } : {}),
      line: m.getStartLineNumber(),
      endLine: m.getEndLineNumber(),
    } satisfies ResolvedTypeMember];
  });
}
