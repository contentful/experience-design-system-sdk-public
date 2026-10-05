import { Node } from 'ts-morph';
import { getTypeReferenceName, getNodeDefinitions } from '../../shared/helpers/tsx-shared.js';
import { isExpandableDomAttributeWrapperName, type ExpandableDomAttributeWrapperContext } from './dom-attribute-surfaces.js';

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

export function getStringLiteralTypeValues(typeNode: Node): string[] {
  if (Node.isLiteralTypeNode(typeNode)) {
    const literal = typeNode.getLiteral();
    if (Node.isStringLiteral(literal)) return [literal.getLiteralText()];
  }
  if (!Node.isUnionTypeNode(typeNode)) return [];
  return typeNode.getTypeNodes().flatMap((n) => getStringLiteralTypeValues(n));
}

export function collectExpandableDomAttributeWrapperContexts(
  typeNode: Node,
  seen = new Set<Node>(),
  excludedProps = new Set<string>(),
): ExpandableDomAttributeWrapperContext[] {
  if (seen.has(typeNode)) return [];
  seen.add(typeNode);

  if (Node.isParenthesizedTypeNode(typeNode) || Node.isTypeOperatorTypeNode(typeNode)) {
    return collectExpandableDomAttributeWrapperContexts(typeNode.getTypeNode(), seen, excludedProps);
  }

  if (Node.isIntersectionTypeNode(typeNode) || Node.isUnionTypeNode(typeNode)) {
    return typeNode
      .getTypeNodes()
      .flatMap((child) => collectExpandableDomAttributeWrapperContexts(child, seen, excludedProps));
  }

  const typeReferenceTarget = getTypeReferenceTargetNode(typeNode);
  if (typeReferenceTarget) {
    const typeName = getTypeReferenceName(typeNode);
    if (!typeName) return [];
    const typeArguments = getTypeReferenceArguments(typeNode);

    if (isExpandableDomAttributeWrapperName(typeName)) {
      return [{ name: typeName, excludedProps: new Set(excludedProps) }];
    }

    if (typeName === 'Omit') {
      const [wrappedType, omittedProps] = typeArguments;
      if (!wrappedType) return [];
      const nextExcludedProps = new Set(excludedProps);
      if (omittedProps) {
        for (const value of getStringLiteralTypeValues(omittedProps)) nextExcludedProps.add(value);
      }
      return collectExpandableDomAttributeWrapperContexts(wrappedType, seen, nextExcludedProps);
    }

    if (typeName === 'Partial' || typeName === 'Readonly' || typeName === 'Required' || typeName === 'NonNullable') {
      const wrappedType = typeArguments[0];
      if (!wrappedType) return [];
      return collectExpandableDomAttributeWrapperContexts(wrappedType, seen, excludedProps);
    }

    for (const definition of getNodeDefinitions(typeReferenceTarget)) {
      const declaration = definition.getDeclarationNode();
      if (!declaration) continue;

      if (Node.isInterfaceDeclaration(declaration)) {
        return declaration
          .getHeritageClauses()
          .flatMap((clause) =>
            clause
              .getTypeNodes()
              .flatMap((heritageTypeNode) =>
                collectExpandableDomAttributeWrapperContexts(heritageTypeNode, seen, excludedProps),
              ),
          );
      }

      if (Node.isTypeAliasDeclaration(declaration)) {
        const aliasedTypeNode = declaration.getTypeNode();
        if (!aliasedTypeNode) return [];
        return collectExpandableDomAttributeWrapperContexts(aliasedTypeNode, seen, excludedProps);
      }
    }
  }

  return [];
}
