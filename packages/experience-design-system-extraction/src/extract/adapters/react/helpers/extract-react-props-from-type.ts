import { Node, type Type } from 'ts-morph';
import type { RawPropDefinition } from '../../../model/component.js';
import { extractAllowedValues, getTypeReferenceName, getTypeTargetDeclarations } from '../../support/tsx-shared.js';
import { getSourceLineMetadata } from '../../support/resolution/source-location.js';
import {
  collectExpandableDomAttributeWrapperContexts,
  isPureExpandableDomAttributeWrapperType,
  shouldMergeDomSyntaxExtraction,
  containsImportedOmitWrappedCustomProps,
  getStringLiteralTypeValues,
  getSyntheticDomAttributeProps,
} from './detect-dom-type-patterns.js';
import {
  TRANSPARENT_POLYMORPHIC_TYPE_NAMES,
  isRepoLocalSupportedPolymorphicChain,
  unwrapRepoLocalTransparentPolymorphicWrapper,
} from './detect-react-polymorphic.js';
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

function filterExcludedSyntaxProps(
  extraction: { props: RawPropDefinition[]; hasChildren: boolean },
  excludedProps: Set<string>,
): { props: RawPropDefinition[]; hasChildren: boolean } {
  if (excludedProps.size === 0) return extraction;
  return { ...extraction, props: extraction.props.filter((prop) => !excludedProps.has(prop.name)) };
}

export function extractPropsFromTypeSymbols(
  type: Type,
  slotNames: Set<string>,
  suppressNeverChildrenSlot = false,
): { props: RawPropDefinition[]; hasChildren: boolean } {
  const props: RawPropDefinition[] = [];
  let hasChildren = false;

  for (const property of type.getProperties()) {
    const name = property.getName();

    if (name === 'children') {
      if (suppressNeverChildrenSlot) {
        const declaration = property.getValueDeclaration() ?? property.getDeclarations()[0];
        if (declaration && property.getTypeAtLocation(declaration).isNever()) continue;
      }
      hasChildren = true;
      continue;
    }

    if (slotNames.has(name)) continue;

    const declaration = property.getValueDeclaration() ?? property.getDeclarations()[0];
    if (!declaration) continue;

    const propType = property.getTypeAtLocation(declaration);
    const declarationTypeText =
      'getTypeNode' in declaration && typeof declaration.getTypeNode === 'function'
        ? declaration.getTypeNode()?.getText()
        : undefined;
    const typeText = propType.isAny() && declarationTypeText ? declarationTypeText : propType.getText(declaration);
    const required = !property.isOptional();
    const allowedValues = extractAllowedValues(propType);

    props.push({
      name,
      type: typeText,
      required,
      ...(allowedValues && { allowedValues }),
      ...getSourceLineMetadata(declaration),
    });
  }

  return { props: props.sort((a, b) => a.name.localeCompare(b.name)), hasChildren };
}

function extractPropsFromInterfaceDeclaration(
  declaration: import('ts-morph').InterfaceDeclaration,
  slotNames: Set<string>,
  seen: Set<Node>,
  excludedProps: Set<string>,
  allowImportedOmitWorkspaceFallback: boolean,
  suppressNeverChildrenSlot: boolean,
): { props: RawPropDefinition[]; hasChildren: boolean } {
  const hasExpandableDomHeritage = declaration
    .getHeritageClauses()
    .some((clause) =>
      clause.getTypeNodes().some((typeNode) => collectExpandableDomAttributeWrapperContexts(typeNode).length > 0),
    );
  const symbolType = hasExpandableDomHeritage
    ? declaration
        .getType()
        .getProperties()
        .filter((symbol) => {
          const decl = symbol.getValueDeclaration() ?? symbol.getDeclarations()[0];
          return decl?.getParent() === declaration;
        })
        .reduce(
          (acc, symbol) => {
            const decl = symbol.getValueDeclaration() ?? symbol.getDeclarations()[0];
            if (!decl) return acc;
            const propType = symbol.getTypeAtLocation(decl);
            const typeText = propType.isAny()
              ? (('getTypeNode' in decl &&
                  typeof (decl as { getTypeNode?: () => Node | undefined }).getTypeNode === 'function'
                  ? (decl as { getTypeNode: () => Node | undefined }).getTypeNode()?.getText()
                  : undefined) ?? propType.getText(decl))
              : propType.getText(decl);
            const name = symbol.getName();
            if (name === 'children') {
              if (suppressNeverChildrenSlot && propType.isNever()) return acc;
              acc.hasChildren = true;
              return acc;
            }
            if (slotNames.has(name)) return acc;
            const required = !symbol.isOptional();
            const allowedValues = extractAllowedValues(propType);
            acc.props.push({
              name,
              type: typeText,
              required,
              ...(allowedValues && { allowedValues }),
              ...getSourceLineMetadata(decl),
            });
            return acc;
          },
          { props: [] as RawPropDefinition[], hasChildren: false },
        )
    : extractPropsFromTypeSymbols(declaration.getType(), slotNames, suppressNeverChildrenSlot);
  const ownProps = filterExcludedSyntaxProps(symbolType, excludedProps);
  const inheritedProps = declaration
    .getHeritageClauses()
    .flatMap((clause) =>
      clause
        .getTypeNodes()
        .flatMap(
          (heritageTypeNode) =>
            extractPropsFromTypeNode(
              heritageTypeNode,
              slotNames,
              seen,
              excludedProps,
              allowImportedOmitWorkspaceFallback,
              suppressNeverChildrenSlot,
            ).props,
        ),
    );

  return {
    props: [...ownProps.props, ...inheritedProps].sort((a, b) => a.name.localeCompare(b.name)),
    hasChildren: ownProps.hasChildren,
  };
}

function getMappedOmitEquivalentArgs(typeNode: Node): { wrappedType: Node; omittedProps: Node } | undefined {
  if (!Node.isTypeReference(typeNode) && !Node.isExpressionWithTypeArguments(typeNode)) return undefined;

  const [wrappedType, omittedProps] = typeNode.getTypeArguments();
  if (!wrappedType || !omittedProps) return undefined;

  const targetNode = Node.isTypeReference(typeNode) ? typeNode.getTypeName() : typeNode.getExpression();
  for (const declaration of getTypeTargetDeclarations(targetNode, true)) {
    if (!Node.isTypeAliasDeclaration(declaration)) continue;
    if (declaration.getTypeParameters().length !== 2) continue;

    const mappedTypeNode = declaration.getTypeNode();
    const [sourceTypeParameter, excludedKeysParameter] = declaration.getTypeParameters();
    const sourceTypeParameterName = sourceTypeParameter.getName();
    const excludedKeysParameterName = excludedKeysParameter.getName();
    if (!mappedTypeNode) continue;

    if (Node.isTypeReference(mappedTypeNode) || Node.isExpressionWithTypeArguments(mappedTypeNode)) {
      if (getTypeReferenceName(mappedTypeNode) !== 'Omit') continue;
      const [innerWrappedType, innerOmittedProps] = mappedTypeNode.getTypeArguments();
      if (!innerWrappedType || !innerOmittedProps) continue;
      if (innerWrappedType.getText() !== sourceTypeParameterName) continue;
      if (innerOmittedProps.getText() !== excludedKeysParameterName) continue;
      return { wrappedType, omittedProps };
    }

    if (!Node.isMappedTypeNode(mappedTypeNode)) continue;

    const iterationParameter = mappedTypeNode.getTypeParameter();
    const iterationParameterName = iterationParameter.getName();

    if (iterationParameter.getConstraint()?.getText() !== `keyof ${sourceTypeParameterName}`) continue;
    if (
      mappedTypeNode.getNameTypeNode()?.getText() !==
      `${iterationParameterName} extends ${excludedKeysParameterName} ? never : ${iterationParameterName}`
    ) {
      continue;
    }
    if (mappedTypeNode.getTypeNode()?.getText() !== `${sourceTypeParameterName}[${iterationParameterName}]`) continue;

    return { wrappedType, omittedProps };
  }

  return undefined;
}

export function extractPropsFromTypeNode(
  typeNode: Node,
  slotNames: Set<string>,
  seen = new Set<Node>(),
  excludedProps = new Set<string>(),
  allowImportedOmitWorkspaceFallback = false,
  suppressNeverChildrenSlot = false,
): { props: RawPropDefinition[]; hasChildren: boolean } {
  if (seen.has(typeNode)) return { props: [], hasChildren: false };
  seen.add(typeNode);

  if (Node.isParenthesizedTypeNode(typeNode) || Node.isTypeOperatorTypeNode(typeNode)) {
    return extractPropsFromTypeNode(
      typeNode.getTypeNode(),
      slotNames,
      seen,
      excludedProps,
      allowImportedOmitWorkspaceFallback,
      suppressNeverChildrenSlot,
    );
  }

  if (Node.isIntersectionTypeNode(typeNode) || Node.isUnionTypeNode(typeNode)) {
    const propsByName = new Map<string, RawPropDefinition>();
    let hasChildren = false;

    for (const childTypeNode of typeNode.getTypeNodes()) {
      const extracted = extractPropsFromTypeNode(
        childTypeNode,
        slotNames,
        seen,
        excludedProps,
        allowImportedOmitWorkspaceFallback,
        suppressNeverChildrenSlot,
      );
      hasChildren ||= extracted.hasChildren;
      for (const prop of extracted.props) {
        propsByName.set(prop.name, prop);
      }
    }

    return { props: [...propsByName.values()], hasChildren };
  }

  if (Node.isTypeLiteral(typeNode)) {
    return filterExcludedSyntaxProps(
      extractPropsFromTypeSymbols(typeNode.getType(), slotNames, suppressNeverChildrenSlot),
      excludedProps,
    );
  }

  if (Node.isInterfaceDeclaration(typeNode)) {
    return extractPropsFromInterfaceDeclaration(
      typeNode,
      slotNames,
      seen,
      excludedProps,
      allowImportedOmitWorkspaceFallback,
      suppressNeverChildrenSlot,
    );
  }

  const typeReferenceTarget = getTypeReferenceTargetNode(typeNode);
  if (typeReferenceTarget) {
    const typeName = getTypeReferenceName(typeNode);
    if (!typeName) return { props: [], hasChildren: false };
    const typeArguments = getTypeReferenceArguments(typeNode);

    if (typeName === 'PropsWithChildren') {
      const wrappedType = typeArguments[0];
      if (!wrappedType) return { props: [], hasChildren: true };
      const extracted = extractPropsFromTypeNode(
        wrappedType,
        slotNames,
        seen,
        excludedProps,
        allowImportedOmitWorkspaceFallback,
        suppressNeverChildrenSlot,
      );
      return { props: extracted.props, hasChildren: true };
    }

    if (isExpandableDomAttributeWrapperName(typeName) || typeName === 'Pick') {
      return typeName === 'Pick'
        ? { props: extractPickedPropsFromTypeNode(typeNode, slotNames, excludedProps), hasChildren: false }
        : { props: [], hasChildren: false };
    }

    if (
      typeName === 'Omit' ||
      typeName === 'Partial' ||
      typeName === 'Readonly' ||
      typeName === 'Required' ||
      typeName === 'NonNullable'
    ) {
      const wrappedType = typeArguments[0];
      if (!wrappedType) return { props: [], hasChildren: false };

      const nextExcludedProps = new Set(excludedProps);
      if (typeName === 'Omit') {
        const omittedProps = typeArguments[1];
        if (omittedProps) {
          for (const value of getStringLiteralTypeValues(omittedProps)) {
            nextExcludedProps.add(value);
          }
        }
      }

      return extractPropsFromTypeNode(
        wrappedType,
        slotNames,
        seen,
        nextExcludedProps,
        allowImportedOmitWorkspaceFallback || typeName === 'Omit',
        suppressNeverChildrenSlot,
      );
    }

    const mappedOmitArgs = allowImportedOmitWorkspaceFallback ? getMappedOmitEquivalentArgs(typeNode) : undefined;
    if (mappedOmitArgs) {
      const nextExcludedProps = new Set(excludedProps);
      for (const value of getStringLiteralTypeValues(mappedOmitArgs.omittedProps)) {
        nextExcludedProps.add(value);
      }
      return extractPropsFromTypeNode(
        mappedOmitArgs.wrappedType,
        slotNames,
        seen,
        nextExcludedProps,
        true,
        suppressNeverChildrenSlot,
      );
    }

    const wrappedTypeNode =
      unwrapRepoLocalTransparentPolymorphicWrapper(typeNode, allowImportedOmitWorkspaceFallback) ??
      (!allowImportedOmitWorkspaceFallback
        ? unwrapRepoLocalTransparentPolymorphicWrapper(typeNode, true)
        : undefined);
    if (wrappedTypeNode) {
      return extractPropsFromTypeNode(
        wrappedTypeNode,
        slotNames,
        seen,
        excludedProps,
        allowImportedOmitWorkspaceFallback,
        true,
      );
    }

    if (TRANSPARENT_POLYMORPHIC_TYPE_NAMES.has(typeName)) return { props: [], hasChildren: false };

    for (const declaration of getTypeTargetDeclarations(typeReferenceTarget, allowImportedOmitWorkspaceFallback)) {
      if (!declaration) continue;

      if (Node.isInterfaceDeclaration(declaration)) {
        return extractPropsFromInterfaceDeclaration(
          declaration,
          slotNames,
          seen,
          excludedProps,
          allowImportedOmitWorkspaceFallback,
          suppressNeverChildrenSlot,
        );
      }

      if (Node.isTypeAliasDeclaration(declaration)) {
        const aliasedTypeNode = declaration.getTypeNode();
        if (!aliasedTypeNode) continue;
        return extractPropsFromTypeNode(
          aliasedTypeNode,
          slotNames,
          seen,
          excludedProps,
          allowImportedOmitWorkspaceFallback,
          suppressNeverChildrenSlot,
        );
      }
    }
  }

  return { props: [], hasChildren: false };
}

export function extractPickedPropsFromTypeNode(
  typeNode: Node,
  slotNames: Set<string>,
  excludedProps = new Set<string>(),
): RawPropDefinition[] {
  if (!Node.isTypeReference(typeNode) && !Node.isExpressionWithTypeArguments(typeNode)) return [];

  const [sourceTypeNode, pickedKeysNode] = typeNode.getTypeArguments();
  if (!sourceTypeNode || !pickedKeysNode) return [];

  const sourcePropsByName = new Map<string, RawPropDefinition>();
  for (const prop of getSyntheticDomAttributeProps(sourceTypeNode)) {
    sourcePropsByName.set(prop.name, prop);
  }
  for (const prop of extractPropsFromTypeNode(sourceTypeNode, slotNames, undefined, excludedProps).props) {
    if (!sourcePropsByName.has(prop.name)) sourcePropsByName.set(prop.name, prop);
  }
  const pickedKeys = getStringLiteralTypeValues(pickedKeysNode);
  const props: RawPropDefinition[] = [];

  for (const name of pickedKeys) {
    if (slotNames.has(name)) continue;
    if (excludedProps.has(name)) continue;
    const pickedProp = sourcePropsByName.get(name);
    if (pickedProp) props.push(pickedProp);
  }

  return props.sort((a, b) => a.name.localeCompare(b.name));
}

export function extractPropsFromType(
  type: Type,
  slotNames: Set<string>,
  typeNode?: Node,
): { props: RawPropDefinition[]; hasChildren: boolean } {
  const supportsRepoLocalPolymorphicAlias =
    typeNode !== undefined && isRepoLocalSupportedPolymorphicChain(typeNode, new Set<Node>(), true);

  const suppressNeverChildrenSlot = supportsRepoLocalPolymorphicAlias;
  const isPureDomWrapper = typeNode !== undefined && isPureExpandableDomAttributeWrapperType(typeNode);
  const symbolExtraction =
    supportsRepoLocalPolymorphicAlias || isPureDomWrapper
      ? { props: [], hasChildren: false }
      : extractPropsFromTypeSymbols(type, slotNames, suppressNeverChildrenSlot);
  const syntaxExtraction =
    typeNode &&
    (symbolExtraction.props.length === 0 ||
      shouldMergeDomSyntaxExtraction(typeNode) ||
      containsImportedOmitWrappedCustomProps(typeNode))
      ? extractPropsFromTypeNode(typeNode, slotNames, undefined, new Set<string>(), false, suppressNeverChildrenSlot)
      : { props: [], hasChildren: false };

  const propsByName = new Map<string, RawPropDefinition>();
  const useSyntaxOnly = typeNode !== undefined && shouldMergeDomSyntaxExtraction(typeNode);
  if (!useSyntaxOnly) {
    for (const prop of symbolExtraction.props) {
      propsByName.set(prop.name, prop);
    }
  }
  for (const prop of syntaxExtraction.props) {
    propsByName.set(prop.name, prop);
  }

  return {
    props: [...propsByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    hasChildren: symbolExtraction.hasChildren || syntaxExtraction.hasChildren,
  };
}
