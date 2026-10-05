import { Node } from 'ts-morph';
import { getTypeReferenceName, getTypeTargetDeclarations } from '../../shared/helpers/tsx-shared.js';
import { getTypeReferenceTargetNode } from '../../shared/helpers/tsx-node-utils.js';
import { isPureExpandableDomAttributeWrapperType } from './detect-dom-is-pure-wrapper.js';

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

    const targetNode = getTypeReferenceTargetNode(typeNode)!;
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
