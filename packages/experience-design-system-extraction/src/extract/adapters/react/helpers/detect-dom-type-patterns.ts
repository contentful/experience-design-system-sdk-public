import { Node } from 'ts-morph';
import type { RawPropDefinition } from '../../../model/component.js';
import { getTypeReferenceName, getNodeDefinitions, getTypeTargetDeclarations } from '../../support/tsx-shared.js';
import {
  isExpandableDomAttributeWrapperName,
  getDomAttributeSurface,
  DOM_ATTRIBUTE_WRAPPERS_WITH_SYNTHETIC_CHILDREN,
  type ExpandableDomAttributeWrapperContext,
} from './dom-attribute-surfaces.js';

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
        for (const value of getStringLiteralTypeValues(omittedProps)) {
          nextExcludedProps.add(value);
        }
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

export function containsImportedOmitWrappedCustomProps(
  typeNode: Node,
  seen = new Set<Node>(),
  originSourceFile = typeNode.getSourceFile(),
  sawOmit = false,
): boolean {
  if (seen.has(typeNode)) return false;
  seen.add(typeNode);

  if (Node.isParenthesizedTypeNode(typeNode) || Node.isTypeOperatorTypeNode(typeNode)) {
    return containsImportedOmitWrappedCustomProps(typeNode.getTypeNode(), seen, originSourceFile, sawOmit);
  }

  if (Node.isIntersectionTypeNode(typeNode) || Node.isUnionTypeNode(typeNode)) {
    return typeNode
      .getTypeNodes()
      .some((child) => containsImportedOmitWrappedCustomProps(child, seen, originSourceFile, sawOmit));
  }

  if (Node.isTypeReference(typeNode) || Node.isExpressionWithTypeArguments(typeNode)) {
    const typeName = getTypeReferenceName(typeNode);
    if (!typeName) return false;

    if (typeName === 'PropsWithChildren') {
      const wrappedType = typeNode.getTypeArguments()[0];
      return wrappedType
        ? containsImportedOmitWrappedCustomProps(wrappedType, seen, originSourceFile, sawOmit)
        : false;
    }

    if (typeName === 'Omit') {
      const wrappedType = typeNode.getTypeArguments()[0];
      return wrappedType
        ? containsImportedOmitWrappedCustomProps(wrappedType, seen, originSourceFile, true)
        : false;
    }

    if (typeName === 'Partial' || typeName === 'Readonly' || typeName === 'Required' || typeName === 'NonNullable') {
      const wrappedType = typeNode.getTypeArguments()[0];
      return wrappedType
        ? containsImportedOmitWrappedCustomProps(wrappedType, seen, originSourceFile, sawOmit)
        : false;
    }

    const targetNode = Node.isTypeReference(typeNode) ? typeNode.getTypeName() : typeNode.getExpression();
    for (const declaration of getTypeTargetDeclarations(targetNode, sawOmit)) {
      if (!declaration) continue;

      const declarationSourceFile = declaration.getSourceFile();
      const isImportedDeclaration = declarationSourceFile.getFilePath() !== originSourceFile.getFilePath();

      if (sawOmit && isImportedDeclaration) {
        const declarationTypeNode = Node.isTypeAliasDeclaration(declaration) ? declaration.getTypeNode() : declaration;
        if (!declarationTypeNode || !isPureExpandableDomAttributeWrapperType(declarationTypeNode)) {
          return true;
        }
      }

      if (Node.isInterfaceDeclaration(declaration)) {
        if (
          declaration
            .getHeritageClauses()
            .some((clause) =>
              clause
                .getTypeNodes()
                .some((heritageTypeNode) =>
                  containsImportedOmitWrappedCustomProps(heritageTypeNode, seen, originSourceFile, sawOmit),
                ),
            )
        ) {
          return true;
        }
      }

      if (Node.isTypeAliasDeclaration(declaration)) {
        const aliasedTypeNode = declaration.getTypeNode();
        if (aliasedTypeNode && containsImportedOmitWrappedCustomProps(aliasedTypeNode, seen, originSourceFile, sawOmit)) {
          return true;
        }
      }
    }
  }

  return false;
}

export function getSyntheticDomAttributeProps(typeNode: Node | undefined): RawPropDefinition[] {
  if (!typeNode) return [];

  const contexts = collectExpandableDomAttributeWrapperContexts(typeNode);
  if (contexts.length === 0) return [];

  const propsByName = new Map<string, RawPropDefinition>();
  for (const context of contexts) {
    for (const prop of getDomAttributeSurface(context.name)) {
      if (context.excludedProps.has(prop.name)) continue;
      if (propsByName.has(prop.name)) continue;
      propsByName.set(prop.name, prop);
    }
  }

  return [...propsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function hasSyntheticDomChildren(typeNode: Node | undefined): boolean {
  if (!typeNode) return false;
  return collectExpandableDomAttributeWrapperContexts(typeNode).some((context) =>
    DOM_ATTRIBUTE_WRAPPERS_WITH_SYNTHETIC_CHILDREN.has(context.name),
  );
}
