import { Node, SyntaxKind, type Type } from 'ts-morph';
import { resolveWorkspaceImportSpecifierDeclarations } from './resolve-tsx-workspace-imports.js';

export function kebabToPascal(input: string): string {
  return input
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');
}

export function extractAllowedValues(type: Type): string[] | undefined {
  if (!type.isUnion()) return undefined;

  const literals = type
    .getUnionTypes()
    .filter((t) => t.isStringLiteral())
    .map((t) => t.getLiteralValueOrThrow() as string);

  return literals.length >= 2 ? literals.sort() : undefined;
}

export function isIntrinsicJsxElement(tagName: string): boolean {
  return /^[a-z][A-Za-z0-9]*$/.test(tagName);
}

export function getJsxTagNameNode(node: Node): Node | undefined {
  const openingElement = node.getFirstAncestorByKind(SyntaxKind.JsxOpeningElement);
  const selfClosingElement = node.getFirstAncestorByKind(SyntaxKind.JsxSelfClosingElement);
  return openingElement?.getTagNameNode() ?? selfClosingElement?.getTagNameNode();
}

export function getNodeDefinitions(node: Node): { getDeclarationNode(): Node | undefined }[] {
  const anyNode = node as unknown as {
    getDefinitions?: () => { getDeclarationNode(): Node | undefined }[];
  };
  return anyNode.getDefinitions?.() ?? [];
}

export function getTypeTargetDeclarations(targetNode: Node, allowWorkspaceImportFallback = false): Node[] {
  return getNodeDefinitions(targetNode).flatMap((definition) => {
    const declaration = definition.getDeclarationNode();
    if (!declaration) return [];

    if (!allowWorkspaceImportFallback || !Node.isImportSpecifier(declaration)) {
      return [declaration];
    }

    const resolvedDeclarations = resolveWorkspaceImportSpecifierDeclarations(declaration, targetNode);
    return resolvedDeclarations.length > 0 ? resolvedDeclarations : [declaration];
  });
}

export function getValueTargetDeclarations(targetNode: Node): Node[] {
  return getNodeDefinitions(targetNode).flatMap((definition) => {
    const declaration = definition.getDeclarationNode();
    if (!declaration) return [];

    if (!Node.isImportSpecifier(declaration)) {
      return [declaration];
    }

    const resolvedDeclarations = resolveWorkspaceImportSpecifierDeclarations(declaration, targetNode);
    return resolvedDeclarations.length > 0 ? resolvedDeclarations : [declaration];
  });
}

export function getTypeReferenceName(typeNode: Node): string | undefined {
  if (Node.isTypeReference(typeNode)) {
    return typeNode.getTypeName().getText().split('.').pop();
  }

  if (Node.isExpressionWithTypeArguments(typeNode)) {
    return typeNode.getExpression().getText().split('.').pop();
  }

  return undefined;
}
