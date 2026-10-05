import { Node } from 'ts-morph';
import { getTypeReferenceName, getTypeTargetDeclarations } from '../../shared/helpers/tsx-shared.js';
import { getTypeReferenceTargetNode, getTypeReferenceArguments } from '../../shared/helpers/tsx-node-utils.js';

export const TRANSPARENT_POLYMORPHIC_TYPE_NAMES = new Set(['PolymorphicProps', 'PropsWithAs', 'PropsWithHTMLElement']);

export function isRepoLocalTransparentPolymorphicWrapperDeclaration(declaration: Node, typeName: string): boolean {
  if (!Node.isTypeAliasDeclaration(declaration)) return false;
  if (declaration.getSourceFile().getFilePath().includes('/node_modules/')) return false;
  if (!TRANSPARENT_POLYMORPHIC_TYPE_NAMES.has(typeName)) return false;

  const typeParameters = declaration.getTypeParameters();
  const typeNode = declaration.getTypeNode();
  if (!typeNode) return false;

  if (typeName === 'PropsWithAs') {
    if (typeParameters.length !== 2 || !Node.isIntersectionTypeNode(typeNode)) return false;

    const [propsTypeNode, wrapperTypeNode] = typeNode.getTypeNodes();
    if (!propsTypeNode || !wrapperTypeNode) return false;
    if (propsTypeNode.getText() !== typeParameters[0].getName()) return false;
    if (!Node.isTypeLiteral(wrapperTypeNode)) return false;
    if (wrapperTypeNode.getMembers().length !== 1) return false;

    const asProperty = wrapperTypeNode.getProperty('as');
    if (!asProperty || !asProperty.hasQuestionToken()) return false;
    return asProperty.getTypeNode()?.getText() === typeParameters[1].getName();
  }

  if (typeName === 'PropsWithHTMLElement') {
    if (typeParameters.length !== 3) return false;
    if (!Node.isTypeReference(typeNode) && !Node.isExpressionWithTypeArguments(typeNode)) return false;
    if (getTypeReferenceName(typeNode) !== 'Overwrite') return false;

    const [omittedDomPropsTypeNode, propsTypeNode] = typeNode.getTypeArguments();
    if (!omittedDomPropsTypeNode || !propsTypeNode) return false;

    if (
      !Node.isTypeReference(omittedDomPropsTypeNode) &&
      !Node.isExpressionWithTypeArguments(omittedDomPropsTypeNode)
    ) {
      return false;
    }
    if (getTypeReferenceName(omittedDomPropsTypeNode) !== 'Omit') return false;

    const [componentPropsTypeNode, omittedAdditionalPropsTypeNode] = omittedDomPropsTypeNode.getTypeArguments();
    if (!componentPropsTypeNode || !omittedAdditionalPropsTypeNode) return false;
    if (getTypeReferenceName(componentPropsTypeNode) !== 'ComponentPropsWithoutRef') return false;
    if (!Node.isTypeReference(componentPropsTypeNode) && !Node.isExpressionWithTypeArguments(componentPropsTypeNode)) {
      return false;
    }
    if (componentPropsTypeNode.getTypeArguments()[0]?.getText() !== typeParameters[1].getName()) return false;
    if (omittedAdditionalPropsTypeNode.getText() !== typeParameters[2].getName()) return false;
    return propsTypeNode.getText() === typeParameters[0].getName();
  }

  if (typeName === 'PolymorphicProps') {
    if (typeParameters.length !== 3) return false;
    if (!Node.isTypeReference(typeNode) && !Node.isExpressionWithTypeArguments(typeNode)) return false;
    if (getTypeReferenceName(typeNode) !== 'PropsWithAs') return false;

    const [propsTypeNode, elementTypeNode] = typeNode.getTypeArguments();
    if (!propsTypeNode || !elementTypeNode) return false;

    if (!Node.isTypeReference(propsTypeNode) && !Node.isExpressionWithTypeArguments(propsTypeNode)) return false;
    if (getTypeReferenceName(propsTypeNode) !== 'PropsWithHTMLElement') return false;

    const propsTypeArgs = propsTypeNode.getTypeArguments();
    const propsWithAsTargetNode = Node.isTypeReference(typeNode) ? typeNode.getTypeName() : typeNode.getExpression();
    const propsWithHTMLElementTargetNode = Node.isTypeReference(propsTypeNode)
      ? propsTypeNode.getTypeName()
      : propsTypeNode.getExpression();
    const hasExactPropsWithAsDeclaration = getTypeTargetDeclarations(propsWithAsTargetNode, true).some((declaration) =>
      isRepoLocalTransparentPolymorphicWrapperDeclaration(declaration, 'PropsWithAs'),
    );
    const hasExactPropsWithHTMLElementDeclaration = getTypeTargetDeclarations(
      propsWithHTMLElementTargetNode,
      true,
    ).some((declaration) => isRepoLocalTransparentPolymorphicWrapperDeclaration(declaration, 'PropsWithHTMLElement'));

    return (
      hasExactPropsWithAsDeclaration &&
      hasExactPropsWithHTMLElementDeclaration &&
      propsTypeArgs[0]?.getText() === typeParameters[0].getName() &&
      propsTypeArgs[1]?.getText() === typeParameters[1].getName() &&
      propsTypeArgs[2]?.getText() === typeParameters[2].getName() &&
      elementTypeNode.getText() === typeParameters[1].getName()
    );
  }

  return false;
}

export function unwrapRepoLocalTransparentPolymorphicWrapper(
  typeNode: Node,
  allowWorkspaceImportFallback: boolean,
): Node | undefined {
  if (!Node.isTypeReference(typeNode) && !Node.isExpressionWithTypeArguments(typeNode)) return undefined;

  const typeName = getTypeReferenceName(typeNode);
  if (!typeName || !TRANSPARENT_POLYMORPHIC_TYPE_NAMES.has(typeName)) return undefined;

  const firstTypeArg = typeNode.getTypeArguments()[0];
  if (!firstTypeArg) return undefined;

  const targetNode = Node.isTypeReference(typeNode) ? typeNode.getTypeName() : typeNode.getExpression();
  const declarations = getTypeTargetDeclarations(targetNode, allowWorkspaceImportFallback);
  if (!declarations.some((declaration) => isRepoLocalTransparentPolymorphicWrapperDeclaration(declaration, typeName))) {
    return undefined;
  }

  return firstTypeArg;
}

export function isRepoLocalSupportedPolymorphicChain(
  typeNode: Node,
  seen = new Set<Node>(),
  allowWorkspaceImportFallback = false,
): boolean {
  if (seen.has(typeNode)) return false;
  seen.add(typeNode);

  if (Node.isParenthesizedTypeNode(typeNode) || Node.isTypeOperatorTypeNode(typeNode)) {
    return isRepoLocalSupportedPolymorphicChain(typeNode.getTypeNode(), seen, allowWorkspaceImportFallback);
  }

  if (Node.isIntersectionTypeNode(typeNode) || Node.isUnionTypeNode(typeNode)) {
    const childTypes = typeNode.getTypeNodes();
    return (
      childTypes.length > 0 &&
      childTypes.every((child) => isRepoLocalSupportedPolymorphicChain(child, seen, allowWorkspaceImportFallback))
    );
  }

  if (Node.isTypeLiteral(typeNode) || Node.isInterfaceDeclaration(typeNode)) return true;

  if (Node.isTypeReference(typeNode) || Node.isExpressionWithTypeArguments(typeNode)) {
    const typeName = getTypeReferenceName(typeNode);
    if (!typeName) return false;

    if (
      typeName === 'Omit' ||
      typeName === 'Partial' ||
      typeName === 'Readonly' ||
      typeName === 'Required' ||
      typeName === 'NonNullable' ||
      typeName === 'MappedOmit'
    ) {
      const wrappedType = getTypeReferenceArguments(typeNode)[0];
      return wrappedType
        ? isRepoLocalSupportedPolymorphicChain(wrappedType, seen, allowWorkspaceImportFallback)
        : false;
    }

    if (!TRANSPARENT_POLYMORPHIC_TYPE_NAMES.has(typeName)) {
      const targetNode = getTypeReferenceTargetNode(typeNode);
      if (!targetNode) return false;
      for (const declaration of getTypeTargetDeclarations(targetNode, allowWorkspaceImportFallback)) {
        if (!declaration) continue;

        if (Node.isInterfaceDeclaration(declaration)) {
          if (
            declaration
              .getHeritageClauses()
              .some((clause) =>
                clause
                  .getTypeNodes()
                  .every((heritageTypeNode) =>
                    isRepoLocalSupportedPolymorphicChain(heritageTypeNode, seen, allowWorkspaceImportFallback),
                  ),
              )
          ) {
            return true;
          }
        }

        if (Node.isTypeAliasDeclaration(declaration)) {
          const aliasedTypeNode = declaration.getTypeNode();
          if (
            aliasedTypeNode &&
            isRepoLocalSupportedPolymorphicChain(aliasedTypeNode, seen, allowWorkspaceImportFallback)
          ) {
            return true;
          }
        }
      }
      return false;
    }

    const wrappedTypeNode = unwrapRepoLocalTransparentPolymorphicWrapper(typeNode, allowWorkspaceImportFallback);
    return wrappedTypeNode
      ? isRepoLocalSupportedPolymorphicChain(wrappedTypeNode, seen, allowWorkspaceImportFallback)
      : false;
  }

  return false;
}
