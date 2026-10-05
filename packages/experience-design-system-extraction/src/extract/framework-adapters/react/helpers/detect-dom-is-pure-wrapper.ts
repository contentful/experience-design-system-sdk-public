import { Node } from 'ts-morph';
import { getTypeReferenceName, getNodeDefinitions } from '../../shared/helpers/tsx-shared.js';
import { isExpandableDomAttributeWrapperName } from './dom-attribute-surfaces.js';

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

function isPureExpandableDomAttributeWrapperTypeNode(typeNode: Node, seen = new Set<Node>()): boolean {
  if (seen.has(typeNode)) return false;
  seen.add(typeNode);

  if (Node.isParenthesizedTypeNode(typeNode) || Node.isTypeOperatorTypeNode(typeNode)) {
    return isPureExpandableDomAttributeWrapperTypeNode(typeNode.getTypeNode(), seen);
  }

  if (Node.isIntersectionTypeNode(typeNode) || Node.isUnionTypeNode(typeNode)) {
    const childTypes = typeNode.getTypeNodes();
    return (
      childTypes.length > 0 && childTypes.every((child) => isPureExpandableDomAttributeWrapperTypeNode(child, seen))
    );
  }

  const typeReferenceTarget = getTypeReferenceTargetNode(typeNode);
  if (typeReferenceTarget) {
    const typeName = getTypeReferenceName(typeNode);
    if (!typeName) return false;
    const typeArguments = getTypeReferenceArguments(typeNode);

    if (isExpandableDomAttributeWrapperName(typeName)) return true;

    if (
      typeName === 'Omit' ||
      typeName === 'Partial' ||
      typeName === 'Readonly' ||
      typeName === 'Required' ||
      typeName === 'NonNullable'
    ) {
      const wrappedType = typeArguments[0];
      return wrappedType ? isPureExpandableDomAttributeWrapperTypeNode(wrappedType, seen) : false;
    }

    if (typeName === 'Pick') return false;

    for (const definition of getNodeDefinitions(typeReferenceTarget)) {
      const declaration = definition.getDeclarationNode();
      if (!declaration) continue;

      if (Node.isInterfaceDeclaration(declaration)) {
        if (declaration.getMembers().length > 0) return false;
        const heritageClauses = declaration.getHeritageClauses();
        return (
          heritageClauses.length > 0 &&
          heritageClauses.every((clause) =>
            clause
              .getTypeNodes()
              .every((heritageTypeNode) => isPureExpandableDomAttributeWrapperTypeNode(heritageTypeNode, seen)),
          )
        );
      }

      if (Node.isTypeAliasDeclaration(declaration)) {
        const aliasedTypeNode = declaration.getTypeNode();
        if (!aliasedTypeNode) return false;
        return isPureExpandableDomAttributeWrapperTypeNode(aliasedTypeNode, seen);
      }
    }
  }

  return false;
}

export function isPureExpandableDomAttributeWrapperType(typeNode: Node): boolean {
  return isPureExpandableDomAttributeWrapperTypeNode(typeNode);
}
