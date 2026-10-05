import { Node } from 'ts-morph';
import { getTypeReferenceName, getTypeTargetDeclarations } from '../../shared/helpers/tsx-shared.js';
import { collectExpandableDomAttributeWrapperContexts } from './detect-dom-type-patterns.js';

function getTypeReferenceTargetNode(typeNode: Node): Node | undefined {
  if (Node.isTypeReference(typeNode)) return typeNode.getTypeName();
  if (Node.isExpressionWithTypeArguments(typeNode)) return typeNode.getExpression();
  return undefined;
}

function getTypeReferenceArguments(typeNode: Node): Node[] {
  if (Node.isTypeReference(typeNode) || Node.isExpressionWithTypeArguments(typeNode)) {
    return typeNode.getTypeArguments();
  }
  return [];
}

function containsPickType(typeNode: Node, seen: Set<Node>, mode: 'supported' | 'any'): boolean {
  if (seen.has(typeNode)) return false;
  seen.add(typeNode);

  if (Node.isParenthesizedTypeNode(typeNode) || Node.isTypeOperatorTypeNode(typeNode)) {
    return containsPickType(typeNode.getTypeNode(), seen, mode);
  }

  if (Node.isIntersectionTypeNode(typeNode) || Node.isUnionTypeNode(typeNode)) {
    return typeNode.getTypeNodes().some((child) => containsPickType(child, seen, mode));
  }

  const typeReferenceTarget = getTypeReferenceTargetNode(typeNode);
  if (!typeReferenceTarget) return false;

  const typeName = getTypeReferenceName(typeNode);
  if (!typeName) return false;
  const typeArguments = getTypeReferenceArguments(typeNode);

  if (typeName === 'Pick') {
    if (mode === 'any') return true;
    const sourceTypeNode = typeArguments[0];
    return sourceTypeNode
      ? collectExpandableDomAttributeWrapperContexts(sourceTypeNode).length > 0 ||
          containsPickType(sourceTypeNode, seen, mode)
      : false;
  }

  const wrappedTypeNames =
    mode === 'any'
      ? ['PropsWithChildren', 'Omit', 'Partial', 'Readonly', 'Required', 'NonNullable']
      : ['Omit', 'Partial', 'Readonly', 'Required', 'NonNullable'];
  if (wrappedTypeNames.includes(typeName)) {
    const wrappedType = typeArguments[0];
    return wrappedType ? containsPickType(wrappedType, seen, mode) : false;
  }

  for (const declaration of getTypeTargetDeclarations(typeReferenceTarget, mode === 'any')) {
    if (!declaration) continue;

    if (Node.isInterfaceDeclaration(declaration)) {
      if (
        declaration
          .getHeritageClauses()
          .some((clause) =>
            clause.getTypeNodes().some((heritageTypeNode) => containsPickType(heritageTypeNode, seen, mode)),
          )
      ) {
        return true;
      }
    }

    if (Node.isTypeAliasDeclaration(declaration)) {
      const aliasedTypeNode = declaration.getTypeNode();
      if (aliasedTypeNode && containsPickType(aliasedTypeNode, seen, mode)) return true;
    }
  }

  return false;
}

export function containsSupportedDomPickType(typeNode: Node, seen = new Set<Node>()): boolean {
  return containsPickType(typeNode, seen, 'supported');
}

export function containsAnyPickType(typeNode: Node, seen = new Set<Node>()): boolean {
  return containsPickType(typeNode, seen, 'any');
}

export function shouldMergeDomSyntaxExtraction(typeNode: Node): boolean {
  return collectExpandableDomAttributeWrapperContexts(typeNode).length > 0 || containsSupportedDomPickType(typeNode);
}
