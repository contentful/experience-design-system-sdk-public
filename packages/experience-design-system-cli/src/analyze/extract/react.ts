import {
  Project,
  Node,
  SyntaxKind,
  type SourceFile,
  type FunctionDeclaration,
  type ArrowFunction,
  type FunctionExpression,
  type VariableDeclaration,
  type ParameterDeclaration,
  type Type,
} from 'ts-morph';
import type {
  RawComponentDefinition,
  RawPropDefinition,
  RawSlotDefinition,
  ComponentExtractionResult,
} from '../../types.js';
import {
  extractAllowedValues,
  getNodeDefinitions,
  getTypeReferenceName,
  getTypeTargetDeclarations,
} from './tsx-shared.js';
import { shouldBeSlot } from './slot-detection.js';

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;
const PROP_WRAPPER_TYPE_NAMES = new Set(['ExpandProps']);
const CHILD_WRAPPER_TYPE_NAMES = new Set(['PropsWithChildren']);
const TRANSPARENT_POLYMORPHIC_TYPE_NAMES = new Set(['PolymorphicProps', 'PropsWithAs', 'PropsWithHTMLElement']);
const EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES = new Set([
  'HTMLProps',
  'HTMLAttributes',
  'ImgHTMLAttributes',
  'LiHTMLAttributes',
  'AnchorHTMLAttributes',
  'ButtonHTMLAttributes',
  'InputHTMLAttributes',
  'FieldsetHTMLAttributes',
  'LabelHTMLAttributes',
  'SelectHTMLAttributes',
  'SVGAttributes',
  'SVGProps',
  'TextareaHTMLAttributes',
  'TdHTMLAttributes',
]);

type ExpandableDomAttributeWrapperName = (typeof EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES extends Set<infer T> ? T : never) &
  string;

type ExpandableDomAttributeWrapperContext = {
  name: ExpandableDomAttributeWrapperName;
  excludedProps: Set<string>;
};

const DOM_ATTRIBUTE_PROP_SURFACES: Record<ExpandableDomAttributeWrapperName, RawPropDefinition[]> = {
  HTMLProps: [],
  HTMLAttributes: [
    { name: 'className', type: 'string', required: false },
    { name: 'hidden', type: 'boolean', required: false },
    { name: 'id', type: 'string', required: false },
    {
      name: 'onClick',
      type: 'MouseEventHandler<HTMLElement>',
      required: false,
    },
    { name: 'style', type: 'CSSProperties', required: false },
    { name: 'tabIndex', type: 'number', required: false },
    { name: 'title', type: 'string', required: false },
  ],
  ImgHTMLAttributes: [
    { name: 'alt', type: 'string', required: false },
    { name: 'crossOrigin', type: 'string', required: false },
    { name: 'height', type: 'number | string', required: false },
    {
      name: 'loading',
      type: 'string',
      required: false,
      allowedValues: ['eager', 'lazy'],
    },
    { name: 'sizes', type: 'string', required: false },
    { name: 'src', type: 'string', required: false },
    { name: 'srcSet', type: 'string', required: false },
    { name: 'width', type: 'number | string', required: false },
  ],
  LiHTMLAttributes: [],
  AnchorHTMLAttributes: [
    { name: 'download', type: 'boolean | string', required: false },
    { name: 'href', type: 'string', required: false },
    { name: 'hrefLang', type: 'string', required: false },
    { name: 'referrerPolicy', type: 'string', required: false },
    { name: 'rel', type: 'string', required: false },
    {
      name: 'target',
      type: 'string',
      required: false,
      allowedValues: ['_blank', '_parent', '_self', '_top'],
    },
  ],
  ButtonHTMLAttributes: [
    { name: 'autoFocus', type: 'boolean', required: false },
    { name: 'disabled', type: 'boolean', required: false },
    { name: 'form', type: 'string', required: false },
    { name: 'formAction', type: 'string', required: false },
    { name: 'formMethod', type: 'string', required: false },
    { name: 'formNoValidate', type: 'boolean', required: false },
    { name: 'formTarget', type: 'string', required: false },
    { name: 'name', type: 'string', required: false },
    {
      name: 'type',
      type: 'string',
      required: false,
      allowedValues: ['button', 'reset', 'submit'],
    },
    {
      name: 'value',
      type: 'string | number | readonly string[]',
      required: false,
    },
  ],
  InputHTMLAttributes: [
    { name: 'autoComplete', type: 'string', required: false },
    { name: 'checked', type: 'boolean', required: false },
    { name: 'disabled', type: 'boolean', required: false },
    { name: 'max', type: 'number | string', required: false },
    { name: 'maxLength', type: 'number', required: false },
    { name: 'min', type: 'number | string', required: false },
    { name: 'minLength', type: 'number', required: false },
    { name: 'name', type: 'string', required: false },
    {
      name: 'onChange',
      type: 'ChangeEventHandler<HTMLInputElement>',
      required: false,
    },
    { name: 'placeholder', type: 'string', required: false },
    { name: 'readOnly', type: 'boolean', required: false },
    { name: 'required', type: 'boolean', required: false },
    { name: 'type', type: 'string', required: false },
    {
      name: 'value',
      type: 'string | number | readonly string[]',
      required: false,
    },
  ],
  FieldsetHTMLAttributes: [
    { name: 'disabled', type: 'boolean', required: false },
    { name: 'form', type: 'string', required: false },
    { name: 'name', type: 'string', required: false },
  ],
  LabelHTMLAttributes: [
    { name: 'form', type: 'string', required: false },
    { name: 'htmlFor', type: 'string', required: false },
  ],
  SelectHTMLAttributes: [
    { name: 'autoComplete', type: 'string', required: false },
    { name: 'disabled', type: 'boolean', required: false },
    { name: 'form', type: 'string', required: false },
    { name: 'multiple', type: 'boolean', required: false },
    { name: 'name', type: 'string', required: false },
    {
      name: 'onChange',
      type: 'ChangeEventHandler<HTMLSelectElement>',
      required: false,
    },
    { name: 'required', type: 'boolean', required: false },
    { name: 'size', type: 'number', required: false },
    {
      name: 'value',
      type: 'string | number | readonly string[]',
      required: false,
    },
  ],
  SVGAttributes: [
    {
      name: 'focusable',
      type: 'boolean | "auto"',
      required: false,
      allowedValues: ['auto'],
    },
    { name: 'height', type: 'number | string', required: false },
    { name: 'viewBox', type: 'string', required: false },
    { name: 'width', type: 'number | string', required: false },
  ],
  SVGProps: [],
  TextareaHTMLAttributes: [
    { name: 'autoComplete', type: 'string', required: false },
    { name: 'cols', type: 'number', required: false },
    { name: 'disabled', type: 'boolean', required: false },
    { name: 'maxLength', type: 'number', required: false },
    { name: 'minLength', type: 'number', required: false },
    { name: 'name', type: 'string', required: false },
    {
      name: 'onChange',
      type: 'ChangeEventHandler<HTMLTextAreaElement>',
      required: false,
    },
    { name: 'placeholder', type: 'string', required: false },
    { name: 'readOnly', type: 'boolean', required: false },
    { name: 'required', type: 'boolean', required: false },
    { name: 'rows', type: 'number', required: false },
    {
      name: 'value',
      type: 'string | number | readonly string[]',
      required: false,
    },
    { name: 'wrap', type: 'string', required: false },
  ],
  TdHTMLAttributes: [
    {
      name: 'align',
      type: 'string',
      required: false,
      allowedValues: ['center', 'char', 'justify', 'left', 'right'],
    },
    { name: 'colSpan', type: 'number', required: false },
    { name: 'headers', type: 'string', required: false },
    { name: 'rowSpan', type: 'number', required: false },
    { name: 'scope', type: 'string', required: false },
  ],
};

const DOM_ATTRIBUTE_WRAPPER_PARENTS: Partial<
  Record<ExpandableDomAttributeWrapperName, ExpandableDomAttributeWrapperName[]>
> = {
  HTMLProps: ['HTMLAttributes'],
  AnchorHTMLAttributes: ['HTMLAttributes'],
  ButtonHTMLAttributes: ['HTMLAttributes'],
  ImgHTMLAttributes: ['HTMLAttributes'],
  InputHTMLAttributes: ['HTMLAttributes'],
  FieldsetHTMLAttributes: ['HTMLAttributes'],
  LabelHTMLAttributes: ['HTMLAttributes'],
  LiHTMLAttributes: ['HTMLAttributes'],
  SelectHTMLAttributes: ['HTMLAttributes'],
  SVGAttributes: ['HTMLAttributes'],
  SVGProps: ['SVGAttributes'],
  TdHTMLAttributes: ['HTMLAttributes'],
  TextareaHTMLAttributes: ['HTMLAttributes'],
};

const DOM_ATTRIBUTE_WRAPPERS_WITH_SYNTHETIC_CHILDREN = new Set<ExpandableDomAttributeWrapperName>([
  'LabelHTMLAttributes',
]);
const JSX_PRIMITIVE_DOM_ATTRIBUTE_SURFACES: Partial<Record<string, ExpandableDomAttributeWrapperName>> = {
  'Primitive.button': 'ButtonHTMLAttributes',
  'Primitive.input': 'InputHTMLAttributes',
  'Primitive.label': 'LabelHTMLAttributes',
};

function getBoundedImportedJsxDomSurface(tagNameNode: Node): ExpandableDomAttributeWrapperName | undefined {
  if (!Node.isIdentifier(tagNameNode)) return undefined;

  const localName = tagNameNode.getText();
  if (!/label/i.test(localName)) return undefined;

  const declarations = tagNameNode.getSymbol()?.getDeclarations() ?? [];
  for (const declaration of declarations) {
    if (!Node.isImportSpecifier(declaration)) continue;

    const importDeclaration = declaration.getImportDeclaration();
    const moduleSpecifier = importDeclaration.getModuleSpecifierValue();
    const importedName = declaration.getNameNode().getText();
    const aliasName = declaration.getAliasNode()?.getText();

    if (
      /label/i.test(moduleSpecifier) ||
      /label/i.test(importedName) ||
      (aliasName !== undefined && /label/i.test(aliasName))
    ) {
      return 'LabelHTMLAttributes';
    }
  }

  return undefined;
}

function isStencilFile(sourceFile: SourceFile): boolean {
  return sourceFile.getImportDeclarations().some((imp) => imp.getModuleSpecifierValue() === '@stencil/core');
}

function isNextJsComponent(filePath: string, exportedNames: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  const isAppRouterFile = /\/app\/.*\/(page|layout)\.[jt]sx?$/.test(normalized);
  const hasNextExports = exportedNames.some((name) => name === 'generateMetadata' || name === 'generateStaticParams');
  return isAppRouterFile || hasNextExports;
}

function isRepoLocalTransparentPolymorphicWrapperDeclaration(declaration: Node, typeName: string): boolean {
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
    if (getTypeReferenceName(componentPropsTypeNode) !== 'ComponentPropsWithoutRef') {
      return false;
    }
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

    if (!Node.isTypeReference(propsTypeNode) && !Node.isExpressionWithTypeArguments(propsTypeNode)) {
      return false;
    }
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

function unwrapRepoLocalTransparentPolymorphicWrapper(
  typeNode: Node,
  allowWorkspaceImportFallback: boolean,
): Node | undefined {
  if (!Node.isTypeReference(typeNode) && !Node.isExpressionWithTypeArguments(typeNode)) {
    return undefined;
  }

  const typeName = getTypeReferenceName(typeNode);
  if (!typeName || !TRANSPARENT_POLYMORPHIC_TYPE_NAMES.has(typeName)) {
    return undefined;
  }

  const firstTypeArg = typeNode.getTypeArguments()[0];
  if (!firstTypeArg) return undefined;

  const targetNode = Node.isTypeReference(typeNode) ? typeNode.getTypeName() : typeNode.getExpression();
  const declarations = getTypeTargetDeclarations(targetNode, allowWorkspaceImportFallback);
  if (!declarations.some((declaration) => isRepoLocalTransparentPolymorphicWrapperDeclaration(declaration, typeName))) {
    return undefined;
  }

  return firstTypeArg;
}

function isRepoLocalSupportedPolymorphicChain(
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

  if (Node.isTypeLiteral(typeNode) || Node.isInterfaceDeclaration(typeNode)) {
    return true;
  }

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
      const wrappedType = typeNode.getTypeArguments()[0];
      return wrappedType
        ? isRepoLocalSupportedPolymorphicChain(wrappedType, seen, allowWorkspaceImportFallback)
        : false;
    }

    if (!TRANSPARENT_POLYMORPHIC_TYPE_NAMES.has(typeName)) {
      const targetNode = Node.isTypeReference(typeNode) ? typeNode.getTypeName() : typeNode.getExpression();
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

function isRenderPropType(type: Type): boolean {
  const callSignatures = type.getCallSignatures();
  if (callSignatures.length === 0) return false;

  const returnType = callSignatures[0].getReturnType();
  const returnText = returnType.getText();
  return /ReactNode|ReactElement|JSX\.Element|Element/.test(returnText);
}

function extractPropsFromType(
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

function extractPropsFromTypeSymbols(
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
        if (declaration && property.getTypeAtLocation(declaration).isNever()) {
          continue;
        }
      }
      hasChildren = true;
      continue;
    }

    // Skip props that are render props — they become slots
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
    });
  }

  return {
    props: props.sort((a, b) => a.name.localeCompare(b.name)),
    hasChildren,
  };
}

function filterExcludedSyntaxProps(
  extraction: { props: RawPropDefinition[]; hasChildren: boolean },
  excludedProps: Set<string>,
): { props: RawPropDefinition[]; hasChildren: boolean } {
  if (excludedProps.size === 0) return extraction;

  return {
    ...extraction,
    props: extraction.props.filter((prop) => !excludedProps.has(prop.name)),
  };
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
  if (!Node.isTypeReference(typeNode) && !Node.isExpressionWithTypeArguments(typeNode)) {
    return undefined;
  }

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

function extractPropsFromTypeNode(
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

  if (Node.isTypeReference(typeNode)) {
    const typeName = getTypeReferenceName(typeNode);
    if (!typeName) return { props: [], hasChildren: false };

    if (typeName === 'PropsWithChildren') {
      const wrappedType = typeNode.getTypeArguments()[0];
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
        ? {
            props: extractPickedPropsFromTypeNode(typeNode, slotNames, excludedProps),
            hasChildren: false,
          }
        : { props: [], hasChildren: false };
    }

    if (
      typeName === 'Omit' ||
      typeName === 'Partial' ||
      typeName === 'Readonly' ||
      typeName === 'Required' ||
      typeName === 'NonNullable'
    ) {
      const wrappedType = typeNode.getTypeArguments()[0];
      if (!wrappedType) return { props: [], hasChildren: false };

      const nextExcludedProps = new Set(excludedProps);
      if (typeName === 'Omit') {
        const omittedProps = typeNode.getTypeArguments()[1];
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
      (!allowImportedOmitWorkspaceFallback ? unwrapRepoLocalTransparentPolymorphicWrapper(typeNode, true) : undefined);
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

    if (TRANSPARENT_POLYMORPHIC_TYPE_NAMES.has(typeName)) {
      return { props: [], hasChildren: false };
    }

    for (const declaration of getTypeTargetDeclarations(typeNode.getTypeName(), allowImportedOmitWorkspaceFallback)) {
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

  if (Node.isExpressionWithTypeArguments(typeNode)) {
    const typeName = getTypeReferenceName(typeNode);
    if (!typeName) return { props: [], hasChildren: false };

    if (typeName === 'PropsWithChildren') {
      const wrappedType = typeNode.getTypeArguments()[0];
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
        ? {
            props: extractPickedPropsFromTypeNode(typeNode, slotNames, excludedProps),
            hasChildren: false,
          }
        : { props: [], hasChildren: false };
    }

    if (
      typeName === 'Omit' ||
      typeName === 'Partial' ||
      typeName === 'Readonly' ||
      typeName === 'Required' ||
      typeName === 'NonNullable'
    ) {
      const wrappedType = typeNode.getTypeArguments()[0];
      if (!wrappedType) return { props: [], hasChildren: false };

      const nextExcludedProps = new Set(excludedProps);
      if (typeName === 'Omit') {
        const omittedProps = typeNode.getTypeArguments()[1];
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
      (!allowImportedOmitWorkspaceFallback ? unwrapRepoLocalTransparentPolymorphicWrapper(typeNode, true) : undefined);
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

    if (TRANSPARENT_POLYMORPHIC_TYPE_NAMES.has(typeName)) {
      return { props: [], hasChildren: false };
    }

    for (const declaration of getTypeTargetDeclarations(typeNode.getExpression(), allowImportedOmitWorkspaceFallback)) {
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

function collectRenderPropSlotNames(type: Type): Set<string> {
  const names = new Set<string>();
  for (const property of type.getProperties()) {
    const name = property.getName();
    if (!name.startsWith('render')) continue;

    const declaration = property.getValueDeclaration() ?? property.getDeclarations()[0];
    if (!declaration) continue;

    const propType = property.getTypeAtLocation(declaration);
    if (isRenderPropType(propType)) {
      names.add(name);
    }
  }
  return names;
}

function recordBindingPatternDefaults(nameNode: Node, defaults: Map<string, string>): void {
  if (!Node.isObjectBindingPattern(nameNode)) return;

  for (const element of nameNode.getElements()) {
    const initializer = element.getInitializer();
    if (!initializer) continue;

    const propertyNameNode = element.getPropertyNameNode();
    const propName = propertyNameNode?.getText().replace(/^['"]|['"]$/g, '') ?? element.getNameNode().getText();
    const value = initializer.getText().replace(/^['"]|['"]$/g, '');
    defaults.set(propName, value);
  }
}

function extractDefaultValues(func: FunctionLike): Map<string, string> {
  const defaults = new Map<string, string>();

  const params = func.getParameters();

  if (params.length === 0) return defaults;

  const firstParam = params[0];
  const nameNode = firstParam.getNameNode();
  if (Node.isObjectBindingPattern(nameNode)) {
    recordBindingPatternDefaults(nameNode, defaults);
    return defaults;
  }

  if (!Node.isIdentifier(nameNode)) return defaults;

  const body = func.getBody();
  if (!body || !Node.isBlock(body)) return defaults;

  for (const statement of body.getStatements()) {
    if (!Node.isVariableStatement(statement)) continue;

    for (const declaration of statement.getDeclarationList().getDeclarations()) {
      const declarationName = declaration.getNameNode();
      const initializer = declaration.getInitializer();
      if (!Node.isObjectBindingPattern(declarationName)) continue;
      if (!initializer || !Node.isIdentifier(initializer) || initializer.getText() !== nameNode.getText()) continue;

      recordBindingPatternDefaults(declarationName, defaults);
      return defaults;
    }
  }

  return defaults;
}

function isImplementationOnlyAliasProp(func: FunctionLike, propName: string): boolean {
  if (!propName.startsWith('_')) return false;

  const allowedJsxAttributes = new Set([
    'id',
    'htmlFor',
    'aria-activedescendant',
    'aria-controls',
    'aria-describedby',
    'aria-labelledby',
    'aria-owns',
  ]);

  let sawRuntimeUsage = false;

  for (const node of func.getDescendants()) {
    if (!Node.isIdentifier(node) || node.getText() !== propName) continue;

    const bindingElement = node.getFirstAncestor((ancestor) => Node.isBindingElement(ancestor));
    if (bindingElement?.getNameNode() === node) {
      continue;
    }

    const jsxAttribute = node.getFirstAncestor((ancestor) => Node.isJsxAttribute(ancestor));
    if (jsxAttribute) {
      const attributeName = jsxAttribute.getNameNode().getText();
      if (allowedJsxAttributes.has(attributeName)) {
        sawRuntimeUsage = true;
        continue;
      }
      return false;
    }

    const propertyAssignment = node.getFirstAncestor((ancestor) => Node.isPropertyAssignment(ancestor));
    if (propertyAssignment) {
      const propertyName = propertyAssignment.getName();
      if (propertyName === propName) {
        sawRuntimeUsage = true;
        continue;
      }
      return false;
    }

    return false;
  }

  return sawRuntimeUsage;
}

function filterImplementationOnlyAliasProps(props: RawPropDefinition[], func: FunctionLike): RawPropDefinition[] {
  const publicPropNames = new Set(props.filter((prop) => !prop.name.startsWith('_')).map((prop) => prop.name));

  return props.filter((prop) => {
    if (/^__scope[A-Z]/.test(prop.name)) {
      return false;
    }

    if (prop.name.startsWith('_') && publicPropNames.has(prop.name.slice(1))) {
      return false;
    }

    return !isImplementationOnlyAliasProp(func, prop.name);
  });
}

function extractDestructuredBindingFallbackProps(
  func: FunctionLike,
  param: ParameterDeclaration,
  existingPropNames: Set<string>,
  slotNames: Set<string>,
): RawPropDefinition[] {
  const nameNode = param.getNameNode();
  const bindingPatterns: import('ts-morph').ObjectBindingPattern[] = [];
  if (Node.isObjectBindingPattern(nameNode)) {
    bindingPatterns.push(nameNode);
  } else if (Node.isIdentifier(nameNode)) {
    const body = func.getBody();
    const paramName = nameNode.getText();
    if (body) {
      for (const declaration of body.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
        const declarationName = declaration.getNameNode();
        const initializer = declaration.getInitializer();
        if (!Node.isObjectBindingPattern(declarationName)) continue;
        if (!initializer || !Node.isIdentifier(initializer) || initializer.getText() !== paramName) continue;
        bindingPatterns.push(declarationName);
      }
    }
  } else {
    return [];
  }

  const propsByName = new Map<string, RawPropDefinition>();
  const paramType = param.getType();

  for (const bindingPattern of bindingPatterns) {
    for (const element of bindingPattern.getElements()) {
      if (element.getDotDotDotToken()) continue;

      const propName = element.getPropertyNameNode()?.getText() ?? element.getNameNode().getText();
      if (propName === 'children' || existingPropNames.has(propName) || slotNames.has(propName)) continue;
      if (propsByName.has(propName)) continue;

      const property = paramType.getProperty(propName);
      const declaration = property?.getValueDeclaration() ?? property?.getDeclarations()[0];
      const propertyType =
        property && declaration ? property.getTypeAtLocation(declaration).getText(declaration) : 'any';

      propsByName.set(propName, {
        name: propName,
        type: propertyType === 'unknown' ? 'any' : propertyType,
        required: property ? !property.isOptional() : false,
      });
    }
  }

  return [...propsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function extractSlots(type: Type, hasChildren: boolean): RawSlotDefinition[] {
  const slots: RawSlotDefinition[] = [];

  if (hasChildren) {
    slots.push({ name: 'default', isDefault: true });
  }

  for (const property of type.getProperties()) {
    const name = property.getName();
    if (name === 'children') continue;
    if (!name.startsWith('render')) continue;

    const declaration = property.getValueDeclaration() ?? property.getDeclarations()[0];
    if (!declaration) continue;

    const propType = property.getTypeAtLocation(declaration);
    if (!isRenderPropType(propType)) continue;

    const slotName = name.replace(/^render/, '');
    slots.push({
      name: slotName.charAt(0).toLowerCase() + slotName.slice(1),
      isDefault: false,
    });
  }

  return slots.sort((a, b) => a.name.localeCompare(b.name));
}

function isExpandableDomAttributeWrapperName(typeName: string): typeName is ExpandableDomAttributeWrapperName {
  return EXPANDABLE_DOM_ATTRIBUTE_TYPE_NAMES.has(typeName as ExpandableDomAttributeWrapperName);
}

function getStringLiteralTypeValues(typeNode: Node): string[] {
  if (Node.isLiteralTypeNode(typeNode)) {
    const literal = typeNode.getLiteral();
    if (Node.isStringLiteral(literal)) {
      return [literal.getLiteralText()];
    }
  }

  if (!Node.isUnionTypeNode(typeNode)) return [];

  return typeNode.getTypeNodes().flatMap((unionTypeNode) => getStringLiteralTypeValues(unionTypeNode));
}

function shouldMergeDomSyntaxExtraction(typeNode: Node): boolean {
  return collectExpandableDomAttributeWrapperContexts(typeNode).length > 0 || containsSupportedDomPickType(typeNode);
}

function containsImportedOmitWrappedCustomProps(
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
      return wrappedType ? containsImportedOmitWrappedCustomProps(wrappedType, seen, originSourceFile, sawOmit) : false;
    }

    if (typeName === 'Omit') {
      const wrappedType = typeNode.getTypeArguments()[0];
      return wrappedType ? containsImportedOmitWrappedCustomProps(wrappedType, seen, originSourceFile, true) : false;
    }

    if (typeName === 'Partial' || typeName === 'Readonly' || typeName === 'Required' || typeName === 'NonNullable') {
      const wrappedType = typeNode.getTypeArguments()[0];
      return wrappedType ? containsImportedOmitWrappedCustomProps(wrappedType, seen, originSourceFile, sawOmit) : false;
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
        if (
          aliasedTypeNode &&
          containsImportedOmitWrappedCustomProps(aliasedTypeNode, seen, originSourceFile, sawOmit)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

function containsSupportedDomPickType(typeNode: Node, seen = new Set<Node>()): boolean {
  if (seen.has(typeNode)) return false;
  seen.add(typeNode);

  if (Node.isParenthesizedTypeNode(typeNode) || Node.isTypeOperatorTypeNode(typeNode)) {
    return containsSupportedDomPickType(typeNode.getTypeNode(), seen);
  }

  if (Node.isIntersectionTypeNode(typeNode) || Node.isUnionTypeNode(typeNode)) {
    return typeNode.getTypeNodes().some((child) => containsSupportedDomPickType(child, seen));
  }

  if (Node.isTypeReference(typeNode) || Node.isExpressionWithTypeArguments(typeNode)) {
    const typeName = getTypeReferenceName(typeNode);
    if (!typeName) return false;

    if (typeName === 'Pick') {
      const sourceTypeNode = typeNode.getTypeArguments()[0];
      return sourceTypeNode
        ? collectExpandableDomAttributeWrapperContexts(sourceTypeNode).length > 0 ||
            containsSupportedDomPickType(sourceTypeNode, seen)
        : false;
    }

    if (
      typeName === 'Omit' ||
      typeName === 'Partial' ||
      typeName === 'Readonly' ||
      typeName === 'Required' ||
      typeName === 'NonNullable'
    ) {
      const wrappedType = typeNode.getTypeArguments()[0];
      return wrappedType ? containsSupportedDomPickType(wrappedType, seen) : false;
    }

    const targetNode = Node.isTypeReference(typeNode) ? typeNode.getTypeName() : typeNode.getExpression();
    for (const declaration of getTypeTargetDeclarations(targetNode)) {
      if (!declaration) continue;

      if (Node.isInterfaceDeclaration(declaration)) {
        if (
          declaration
            .getHeritageClauses()
            .some((clause) =>
              clause.getTypeNodes().some((heritageTypeNode) => containsSupportedDomPickType(heritageTypeNode, seen)),
            )
        ) {
          return true;
        }
      }

      if (Node.isTypeAliasDeclaration(declaration)) {
        const aliasedTypeNode = declaration.getTypeNode();
        if (aliasedTypeNode && containsSupportedDomPickType(aliasedTypeNode, seen)) {
          return true;
        }
      }
    }
  }

  return false;
}

function containsAnyPickType(typeNode: Node, seen = new Set<Node>()): boolean {
  if (seen.has(typeNode)) return false;
  seen.add(typeNode);

  if (Node.isParenthesizedTypeNode(typeNode) || Node.isTypeOperatorTypeNode(typeNode)) {
    return containsAnyPickType(typeNode.getTypeNode(), seen);
  }

  if (Node.isIntersectionTypeNode(typeNode) || Node.isUnionTypeNode(typeNode)) {
    return typeNode.getTypeNodes().some((child) => containsAnyPickType(child, seen));
  }

  if (Node.isTypeReference(typeNode) || Node.isExpressionWithTypeArguments(typeNode)) {
    const typeName = getTypeReferenceName(typeNode);
    if (!typeName) return false;

    if (typeName === 'Pick') {
      return true;
    }

    const wrappedType = typeNode.getTypeArguments()[0];
    if (
      (typeName === 'PropsWithChildren' ||
        typeName === 'Omit' ||
        typeName === 'Partial' ||
        typeName === 'Readonly' ||
        typeName === 'Required' ||
        typeName === 'NonNullable') &&
      wrappedType
    ) {
      return containsAnyPickType(wrappedType, seen);
    }

    const targetNode = Node.isTypeReference(typeNode) ? typeNode.getTypeName() : typeNode.getExpression();
    for (const declaration of getTypeTargetDeclarations(targetNode, true)) {
      if (!declaration) continue;

      if (Node.isInterfaceDeclaration(declaration)) {
        if (
          declaration
            .getHeritageClauses()
            .some((clause) =>
              clause.getTypeNodes().some((heritageTypeNode) => containsAnyPickType(heritageTypeNode, seen)),
            )
        ) {
          return true;
        }
      }

      if (Node.isTypeAliasDeclaration(declaration)) {
        const aliasedTypeNode = declaration.getTypeNode();
        if (aliasedTypeNode && containsAnyPickType(aliasedTypeNode, seen)) {
          return true;
        }
      }
    }
  }

  return false;
}

function collectExpandableDomAttributeWrapperContexts(
  typeNode: Node,
  seen = new Set<Node>(),
  excludedProps = new Set<string>(),
): ExpandableDomAttributeWrapperContext[] {
  if (seen.has(typeNode)) return [];
  seen.add(typeNode);

  if (Node.isParenthesizedTypeNode(typeNode)) {
    return collectExpandableDomAttributeWrapperContexts(typeNode.getTypeNode(), seen, excludedProps);
  }

  if (Node.isTypeOperatorTypeNode(typeNode)) {
    return collectExpandableDomAttributeWrapperContexts(typeNode.getTypeNode(), seen, excludedProps);
  }

  if (Node.isIntersectionTypeNode(typeNode) || Node.isUnionTypeNode(typeNode)) {
    return typeNode
      .getTypeNodes()
      .flatMap((child) => collectExpandableDomAttributeWrapperContexts(child, seen, excludedProps));
  }

  if (Node.isTypeReference(typeNode)) {
    const typeName = getTypeReferenceName(typeNode);
    if (!typeName) return [];

    if (isExpandableDomAttributeWrapperName(typeName)) {
      return [{ name: typeName, excludedProps: new Set(excludedProps) }];
    }

    if (typeName === 'Omit') {
      const [wrappedType, omittedProps] = typeNode.getTypeArguments();
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
      const wrappedType = typeNode.getTypeArguments()[0];
      if (!wrappedType) return [];
      return collectExpandableDomAttributeWrapperContexts(wrappedType, seen, excludedProps);
    }

    for (const definition of getNodeDefinitions(typeNode.getTypeName())) {
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

  if (Node.isExpressionWithTypeArguments(typeNode)) {
    const typeName = getTypeReferenceName(typeNode);
    if (!typeName) return [];

    if (isExpandableDomAttributeWrapperName(typeName)) {
      return [{ name: typeName, excludedProps: new Set(excludedProps) }];
    }

    if (typeName === 'Omit') {
      const [wrappedType, omittedProps] = typeNode.getTypeArguments();
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
      const wrappedType = typeNode.getTypeArguments()[0];
      if (!wrappedType) return [];
      return collectExpandableDomAttributeWrapperContexts(wrappedType, seen, excludedProps);
    }

    for (const definition of getNodeDefinitions(typeNode.getExpression())) {
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

function isPureExpandableDomAttributeWrapperType(typeNode: Node): boolean {
  return isPureExpandableDomAttributeWrapperTypeNode(typeNode);
}

function isPureExpandableDomAttributeWrapperTypeNode(typeNode: Node, seen = new Set<Node>()): boolean {
  if (seen.has(typeNode)) return false;
  seen.add(typeNode);

  if (Node.isParenthesizedTypeNode(typeNode)) {
    return isPureExpandableDomAttributeWrapperTypeNode(typeNode.getTypeNode(), seen);
  }

  if (Node.isTypeOperatorTypeNode(typeNode)) {
    return isPureExpandableDomAttributeWrapperTypeNode(typeNode.getTypeNode(), seen);
  }

  if (Node.isIntersectionTypeNode(typeNode) || Node.isUnionTypeNode(typeNode)) {
    const childTypes = typeNode.getTypeNodes();
    return (
      childTypes.length > 0 && childTypes.every((child) => isPureExpandableDomAttributeWrapperTypeNode(child, seen))
    );
  }

  if (Node.isTypeReference(typeNode)) {
    const typeName = getTypeReferenceName(typeNode);
    if (!typeName) return false;

    if (isExpandableDomAttributeWrapperName(typeName)) {
      return true;
    }

    if (
      typeName === 'Omit' ||
      typeName === 'Partial' ||
      typeName === 'Readonly' ||
      typeName === 'Required' ||
      typeName === 'NonNullable'
    ) {
      const wrappedType = typeNode.getTypeArguments()[0];
      return wrappedType ? isPureExpandableDomAttributeWrapperTypeNode(wrappedType, seen) : false;
    }

    if (typeName === 'Pick') {
      // Pick narrows the surface and should not be treated as a transparent wrapper.
      return false;
    }

    for (const definition of getNodeDefinitions(typeNode.getTypeName())) {
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

  if (Node.isExpressionWithTypeArguments(typeNode)) {
    const typeName = getTypeReferenceName(typeNode);
    if (!typeName) return false;

    if (isExpandableDomAttributeWrapperName(typeName)) {
      return true;
    }

    if (
      typeName === 'Omit' ||
      typeName === 'Partial' ||
      typeName === 'Readonly' ||
      typeName === 'Required' ||
      typeName === 'NonNullable'
    ) {
      const wrappedType = typeNode.getTypeArguments()[0];
      return wrappedType ? isPureExpandableDomAttributeWrapperTypeNode(wrappedType, seen) : false;
    }

    for (const definition of getNodeDefinitions(typeNode.getExpression())) {
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

function getSyntheticDomAttributeProps(typeNode: Node | undefined): RawPropDefinition[] {
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

function getDomAttributeSurface(
  name: ExpandableDomAttributeWrapperName,
  seen = new Set<ExpandableDomAttributeWrapperName>(),
): RawPropDefinition[] {
  if (seen.has(name)) return [];
  seen.add(name);

  const propsByName = new Map<string, RawPropDefinition>();
  for (const parentName of DOM_ATTRIBUTE_WRAPPER_PARENTS[name] ?? []) {
    for (const prop of getDomAttributeSurface(parentName, seen)) {
      propsByName.set(prop.name, prop);
    }
  }
  for (const prop of DOM_ATTRIBUTE_PROP_SURFACES[name]) {
    propsByName.set(prop.name, prop);
  }

  return [...propsByName.values()];
}

function hasSyntheticDomChildren(typeNode: Node | undefined): boolean {
  if (!typeNode) return false;

  return collectExpandableDomAttributeWrapperContexts(typeNode).some((context) =>
    DOM_ATTRIBUTE_WRAPPERS_WITH_SYNTHETIC_CHILDREN.has(context.name),
  );
}

function inferPrimitiveDomPropsFromImplementation(
  funcNode: FunctionLike,
  propsParam: ParameterDeclaration,
): RawPropDefinition[] {
  const candidatePropNames = new Set<string>();

  const propsParamNameNode = propsParam.getNameNode();
  if (Node.isIdentifier(propsParamNameNode)) {
    candidatePropNames.add(propsParam.getName());
  }

  if (Node.isObjectBindingPattern(propsParamNameNode)) {
    for (const element of propsParamNameNode.getElements()) {
      if (!element.getDotDotDotToken()) continue;
      const restNameNode = element.getNameNode();
      if (Node.isIdentifier(restNameNode)) {
        candidatePropNames.add(restNameNode.getText());
      }
    }
  }

  for (const variableDeclaration of funcNode.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const initializer = variableDeclaration.getInitializer();
    if (!initializer || !Node.isIdentifier(initializer) || !candidatePropNames.has(initializer.getText())) {
      continue;
    }

    const nameNode = variableDeclaration.getNameNode();
    if (!Node.isObjectBindingPattern(nameNode)) continue;

    for (const element of nameNode.getElements()) {
      if (!element.getDotDotDotToken()) continue;
      const restNameNode = element.getNameNode();
      if (Node.isIdentifier(restNameNode)) {
        candidatePropNames.add(restNameNode.getText());
      }
    }
  }

  if (candidatePropNames.size === 0) return [];

  const inferredSurfaces = new Set<ExpandableDomAttributeWrapperName>();
  const jsxElements = [
    ...funcNode.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
    ...funcNode.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
  ];

  for (const jsxElement of jsxElements) {
    const tagNameNode = jsxElement.getTagNameNode();
    const domSurface =
      JSX_PRIMITIVE_DOM_ATTRIBUTE_SURFACES[tagNameNode.getText()] ?? getBoundedImportedJsxDomSurface(tagNameNode);
    if (!domSurface) continue;

    const hasForwardedPropsSpread = jsxElement
      .getAttributes()
      .some(
        (attribute) =>
          Node.isJsxSpreadAttribute(attribute) &&
          Node.isIdentifier(attribute.getExpression()) &&
          candidatePropNames.has(attribute.getExpression().getText()),
      );

    if (hasForwardedPropsSpread) {
      inferredSurfaces.add(domSurface);
    }
  }

  const propsByName = new Map<string, RawPropDefinition>();
  for (const surface of inferredSurfaces) {
    for (const prop of getDomAttributeSurface(surface)) {
      propsByName.set(prop.name, prop);
    }
  }

  return [...propsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function extractPickedPropsFromTypeNode(
  typeNode: Node,
  slotNames: Set<string>,
  excludedProps = new Set<string>(),
): RawPropDefinition[] {
  if (!Node.isTypeReference(typeNode) && !Node.isExpressionWithTypeArguments(typeNode)) {
    return [];
  }

  const [sourceTypeNode, pickedKeysNode] = typeNode.getTypeArguments();
  if (!sourceTypeNode || !pickedKeysNode) return [];

  const sourcePropsByName = new Map<string, RawPropDefinition>();
  for (const prop of getSyntheticDomAttributeProps(sourceTypeNode)) {
    sourcePropsByName.set(prop.name, prop);
  }
  for (const prop of extractPropsFromTypeNode(sourceTypeNode, slotNames, undefined, excludedProps).props) {
    if (!sourcePropsByName.has(prop.name)) {
      sourcePropsByName.set(prop.name, prop);
    }
  }
  const pickedKeys = getStringLiteralTypeValues(pickedKeysNode);
  const props: RawPropDefinition[] = [];

  for (const name of pickedKeys) {
    if (slotNames.has(name)) continue;
    if (excludedProps.has(name)) continue;

    const pickedProp = sourcePropsByName.get(name);
    if (pickedProp) {
      props.push(pickedProp);
    }
  }

  return props.sort((a, b) => a.name.localeCompare(b.name));
}

function normalizePropsTypeNode(typeNode: Node): {
  typeNode: Node;
  hasWrappedChildren: boolean;
  suppressProps: boolean;
} {
  if (!Node.isTypeReference(typeNode)) {
    return { typeNode, hasWrappedChildren: false, suppressProps: false };
  }

  const typeName = getTypeReferenceName(typeNode);
  if (!typeName) {
    return { typeNode, hasWrappedChildren: false, suppressProps: false };
  }

  if (PROP_WRAPPER_TYPE_NAMES.has(typeName)) {
    const firstTypeArg = typeNode.getTypeArguments()[0];
    if (!firstTypeArg) {
      return { typeNode, hasWrappedChildren: false, suppressProps: false };
    }

    return normalizePropsTypeNode(firstTypeArg);
  }

  if (CHILD_WRAPPER_TYPE_NAMES.has(typeName)) {
    const firstTypeArg = typeNode.getTypeArguments()[0];
    if (!firstTypeArg) {
      return { typeNode, hasWrappedChildren: true, suppressProps: false };
    }

    if (isPureExpandableDomAttributeWrapperType(firstTypeArg)) {
      return {
        typeNode: firstTypeArg,
        hasWrappedChildren: true,
        suppressProps: true,
      };
    }

    const normalized = normalizePropsTypeNode(firstTypeArg);
    return {
      ...normalized,
      hasWrappedChildren: true,
    };
  }

  return { typeNode, hasWrappedChildren: false, suppressProps: false };
}

function resolveForwardRefGenericPropsTypeNode(param: ParameterDeclaration): Node | undefined {
  const parent = param.getParent();
  if (!Node.isArrowFunction(parent) && !Node.isFunctionExpression(parent)) {
    return undefined;
  }

  const callExpression = parent.getParent();
  if (!Node.isCallExpression(callExpression)) {
    return undefined;
  }

  const expressionText = callExpression.getExpression().getText();
  if (!/(^|\.)forwardRef$/.test(expressionText)) {
    return undefined;
  }

  const [, propsTypeNode] = callExpression.getTypeArguments();
  return propsTypeNode;
}

const FC_TYPE_NAMES = new Set(['FC', 'FunctionComponent', 'VFC', 'VoidFunctionComponent']);

function resolveFCGenericPropsTypeNode(param: ParameterDeclaration): Node | undefined {
  const funcNode = param.getParent();
  if (!Node.isArrowFunction(funcNode) && !Node.isFunctionExpression(funcNode)) {
    return undefined;
  }

  const varDecl = funcNode.getParent();
  if (!Node.isVariableDeclaration(varDecl)) {
    return undefined;
  }

  const typeNode = (varDecl as VariableDeclaration).getTypeNode();
  if (!typeNode || !Node.isTypeReference(typeNode)) {
    return undefined;
  }

  const typeName = typeNode.getTypeName().getText().split('.').pop();
  if (!typeName || !FC_TYPE_NAMES.has(typeName)) {
    return undefined;
  }

  const typeArgs = typeNode.getTypeArguments();
  return typeArgs[0];
}

function resolvePropsType(param: ParameterDeclaration): {
  type: Type;
  typeNode: Node;
  hasWrappedChildren: boolean;
  suppressProps: boolean;
} {
  const typeNode = param.getTypeNode();
  const fcGenericPropsTypeNode = resolveFCGenericPropsTypeNode(param);
  const fallbackTypeNode = resolveForwardRefGenericPropsTypeNode(param) ?? fcGenericPropsTypeNode;
  const effectiveTypeNode = typeNode ?? fallbackTypeNode;
  if (!effectiveTypeNode) {
    return {
      type: param.getType(),
      typeNode: param.getTypeNode() ?? param,
      hasWrappedChildren: false,
      suppressProps: false,
    };
  }

  const normalized = normalizePropsTypeNode(effectiveTypeNode);
  return {
    type: normalized.typeNode.getType(),
    typeNode: normalized.typeNode,
    hasWrappedChildren: normalized.hasWrappedChildren || fcGenericPropsTypeNode !== undefined,
    suppressProps: normalized.suppressProps,
  };
}

function hasImplementationChildrenHint(funcNode: FunctionLike, param: ParameterDeclaration): boolean {
  const nameNode = param.getNameNode();
  const body = funcNode.getBody();
  if (!body) return false;

  if (Node.isObjectBindingPattern(nameNode)) {
    const restBindingNames = new Set<string>();
    for (const element of nameNode.getElements()) {
      if (element.getNameNode().getText() === 'children') {
        return true;
      }
      if (element.getDotDotDotToken()) {
        restBindingNames.add(element.getNameNode().getText());
      }
    }

    if (restBindingNames.size === 0) return false;

    return body.getDescendantsOfKind(SyntaxKind.JsxSpreadAttribute).some((attr) => {
      const expression = attr.getExpression();
      if (!expression || !Node.isIdentifier(expression)) return false;
      if (!restBindingNames.has(expression.getText())) return false;

      const openingElement = attr.getFirstAncestorByKind(SyntaxKind.JsxOpeningElement);
      const selfClosingElement = attr.getFirstAncestorByKind(SyntaxKind.JsxSelfClosingElement);
      const tagName = openingElement?.getTagNameNode().getText() ?? selfClosingElement?.getTagNameNode().getText();
      return tagName ? /^[A-Z]/.test(tagName) : false;
    });
  }

  if (!Node.isIdentifier(nameNode)) return false;

  const paramName = nameNode.getText();
  if (
    body
      .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
      .some((expr) => expr.getExpression().getText() === paramName && expr.getName() === 'children')
  ) {
    return true;
  }

  return body.getDescendantsOfKind(SyntaxKind.JsxSpreadAttribute).some((attr) => {
    const expression = attr.getExpression();
    if (!expression || !Node.isIdentifier(expression) || expression.getText() !== paramName) return false;

    const openingElement = attr.getFirstAncestorByKind(SyntaxKind.JsxOpeningElement);
    const selfClosingElement = attr.getFirstAncestorByKind(SyntaxKind.JsxSelfClosingElement);
    const tagName = openingElement?.getTagNameNode().getText() ?? selfClosingElement?.getTagNameNode().getText();
    return tagName ? /^[A-Z]/.test(tagName) : false;
  });
}

export async function extractReactComponents(filePaths: string[]): Promise<ComponentExtractionResult> {
  const componentFiles = filePaths.filter((f) => /\.[jt]sx$/.test(f));
  if (componentFiles.length === 0) {
    return { components: [], warnings: [] };
  }

  const projectFiles = filePaths.filter((f) => /\.[jt]sx?$/.test(f) && !f.endsWith('.d.ts'));

  const project = new Project({
    compilerOptions: {
      jsx: 1, // JsxEmit.Preserve
      target: 99, // ScriptTarget.ESNext
      module: 99, // ModuleKind.ESNext
      moduleResolution: 100, // ModuleResolutionKind.Bundler
      skipLibCheck: true,
      allowJs: true,
    },
    skipAddingFilesFromTsConfig: true,
  });

  for (const filePath of projectFiles) {
    project.addSourceFileAtPath(filePath);
  }

  const warnings: string[] = [];
  const components: RawComponentDefinition[] = [];

  for (const filePath of componentFiles) {
    try {
      const sourceFile = project.getSourceFile(filePath);
      if (!sourceFile) continue;
      if (isStencilFile(sourceFile)) continue;
      const fileExports = [...sourceFile.getExportedDeclarations().keys()];
      const isNext = isNextJsComponent(sourceFile.getFilePath(), fileExports);
      const extracted = extractFromSourceFile(sourceFile, isNext);
      components.push(...extracted);
    } catch (e) {
      warnings.push(`Failed to extract from ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
  };
}

function extractFromSourceFile(sourceFile: SourceFile, isNext: boolean): RawComponentDefinition[] {
  const components: RawComponentDefinition[] = [];
  const exported = sourceFile.getExportedDeclarations();

  for (const [exportKey, declarations] of exported) {
    let name = exportKey;

    if (exportKey === 'default') {
      const decl = declarations[0];
      let declName: string | undefined;

      if (Node.isFunctionDeclaration(decl)) {
        declName = decl.getName();
      } else if (Node.isVariableDeclaration(decl)) {
        declName = (decl as VariableDeclaration).getName();
      }

      if (!declName || !/^[A-Z]/.test(declName)) continue;
      if (exported.has(declName)) continue;
      name = declName;
    }

    if (!/^[A-Z]/.test(name)) continue;
    if (name.startsWith('use')) continue;

    const funcNode = resolveBestFunctionNode(declarations);
    if (!funcNode) continue;
    if (funcNode.getSourceFile().getFilePath() !== sourceFile.getFilePath()) continue;

    const params = funcNode.getParameters();
    if (params.length === 0) {
      components.push({
        name,
        source: sourceFile.getFilePath(),
        framework: isNext ? 'next' : 'react',
        props: [],
        slots: [],
      });
      continue;
    }

    const resolvedPropsType = resolvePropsType(params[0]);
    const firstParamType = resolvedPropsType.type;
    const firstParamTypeNode = resolvedPropsType.typeNode;
    const renderPropSlotNames = resolvedPropsType.suppressProps
      ? new Set<string>()
      : collectRenderPropSlotNames(firstParamType);
    const { props, hasChildren } = resolvedPropsType.suppressProps
      ? { props: [], hasChildren: false }
      : extractPropsFromType(firstParamType, renderPropSlotNames, firstParamTypeNode);
    const hasMeaningfulExtractedProps = props.some((prop) => !prop.name.startsWith('__scope'));
    const defaults = extractDefaultValues(funcNode);
    const hasImplementationChildren = hasImplementationChildrenHint(funcNode, params[0]);
    const slots = extractSlots(
      firstParamType,
      hasChildren ||
        resolvedPropsType.hasWrappedChildren ||
        hasSyntheticDomChildren(resolvedPropsType.typeNode) ||
        hasImplementationChildren,
    );
    const syntheticDomProps = resolvedPropsType.suppressProps
      ? []
      : getSyntheticDomAttributeProps(resolvedPropsType.typeNode);
    const implementationPrimitiveDomProps =
      !resolvedPropsType.suppressProps && !hasMeaningfulExtractedProps && syntheticDomProps.length === 0
        ? inferPrimitiveDomPropsFromImplementation(funcNode, params[0])
        : [];
    const shouldTryBindingFallback =
      !resolvedPropsType.suppressProps &&
      (containsImportedOmitWrappedCustomProps(firstParamTypeNode) ||
        containsAnyPickType(firstParamTypeNode) ||
        (!hasMeaningfulExtractedProps && Node.isObjectBindingPattern(params[0].getNameNode())));
    const bindingFallbackProps = shouldTryBindingFallback
      ? extractDestructuredBindingFallbackProps(
          funcNode,
          params[0],
          new Set(props.map((prop) => prop.name)),
          renderPropSlotNames,
        )
      : [];

    const mergedPropsByName = new Map<string, RawPropDefinition>();
    for (const prop of props) {
      mergedPropsByName.set(prop.name, prop);
    }
    for (const prop of syntheticDomProps) {
      if (!mergedPropsByName.has(prop.name)) {
        mergedPropsByName.set(prop.name, prop);
      }
    }
    for (const prop of implementationPrimitiveDomProps) {
      if (!mergedPropsByName.has(prop.name)) {
        mergedPropsByName.set(prop.name, prop);
      }
    }
    for (const prop of bindingFallbackProps) {
      if (!mergedPropsByName.has(prop.name)) {
        mergedPropsByName.set(prop.name, prop);
      }
    }
    const resolvedProps = [...mergedPropsByName.values()];

    const noUsefulTypes = resolvedProps.length === 0 || resolvedProps.every((p) => p.type === 'any');
    const finalProps = noUsefulTypes ? (extractPropTypes(sourceFile, name) ?? resolvedProps) : resolvedProps;

    const propsWithDefaults = finalProps.map((p) => {
      if (!defaults.has(p.name)) return p;
      const defaultValue = defaults.get(p.name)!;

      return {
        ...p,
        required: false,
        defaultValue,
      };
    });

    const filteredProps = filterImplementationOnlyAliasProps(propsWithDefaults, funcNode);

    // Second pass: expand ReactNode-typed props into slots
    const existingSlotNames = new Set(slots.map((s) => s.name));
    const expandedSlots: RawSlotDefinition[] = [];
    const propsAfterSlotExpansion = filteredProps.filter((prop) => {
      if (existingSlotNames.has(prop.name)) return true; // already handled
      if (shouldBeSlot(prop.name, prop.type)) {
        expandedSlots.push({ name: prop.name, isDefault: false });
        return false;
      }
      return true;
    });
    const finalSlots = [...slots, ...expandedSlots];

    components.push({
      name,
      source: sourceFile.getFilePath(),
      framework: isNext ? 'next' : 'react',
      props: propsAfterSlotExpansion,
      slots: finalSlots,
    });
  }

  return components;
}

const PROP_TYPES_MAP: Record<string, string> = {
  string: 'string',
  number: 'number',
  bool: 'boolean',
  func: 'function',
  node: 'ReactNode',
  element: 'ReactElement',
  any: 'any',
  array: 'any[]',
  object: 'object',
  symbol: 'symbol',
};

function extractPropTypes(sourceFile: SourceFile, componentName: string): RawPropDefinition[] | undefined {
  const props: RawPropDefinition[] = [];

  for (const statement of sourceFile.getStatements()) {
    if (!Node.isExpressionStatement(statement)) continue;
    const expr = statement.getExpression();
    if (!Node.isBinaryExpression(expr)) continue;

    const left = expr.getLeft().getText();
    if (left !== `${componentName}.propTypes`) continue;

    const right = expr.getRight();
    if (!Node.isObjectLiteralExpression(right)) continue;

    for (const property of right.getProperties()) {
      if (!Node.isPropertyAssignment(property)) continue;

      const propName = property.getName();
      const initText = property.getInitializer()?.getText() ?? '';

      let type = 'any';
      let required = false;
      let allowedValues: string[] | undefined;

      if (initText.includes('.isRequired')) {
        required = true;
      }

      const oneOfMatch = initText.match(/PropTypes\.oneOf\(\[([^\]]+)\]\)/);
      if (oneOfMatch) {
        allowedValues = oneOfMatch[1]
          .split(',')
          .map((v) => v.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean)
          .sort();
      }

      for (const [ptKey, tsType] of Object.entries(PROP_TYPES_MAP)) {
        if (initText.includes(`PropTypes.${ptKey}`)) {
          type = tsType;
          break;
        }
      }

      props.push({
        name: propName,
        type,
        required,
        ...(allowedValues && { allowedValues }),
      });
    }

    return props.sort((a, b) => a.name.localeCompare(b.name));
  }

  return undefined;
}

function resolveFunctionNode(decl: Node): FunctionLike | undefined {
  if (Node.isFunctionDeclaration(decl)) return decl;
  if (Node.isArrowFunction(decl)) return decl;
  if (Node.isFunctionExpression(decl)) return decl;

  if (Node.isVariableDeclaration(decl)) {
    const init = (decl as VariableDeclaration).getInitializer();
    if (init && Node.isArrowFunction(init)) return init;
    if (init && Node.isFunctionExpression(init)) return init;
    if (init && Node.isCallExpression(init)) return resolveFunctionFromCallExpression(init, new Set<Node>());
  }

  return undefined;
}

function resolveBestFunctionNode(declarations: Node[]): FunctionLike | undefined {
  const candidates = declarations
    .map((decl) => resolveFunctionNode(decl))
    .filter((candidate): candidate is FunctionLike => candidate !== undefined);

  const implementation = candidates.find(
    (candidate) => !Node.isFunctionDeclaration(candidate) || candidate.getBody() !== undefined,
  );

  return implementation ?? candidates[0];
}

function resolveForwardRefFunction(callExpr: Node): FunctionLike | undefined {
  if (!Node.isCallExpression(callExpr)) return undefined;

  const expressionText = callExpr.getExpression().getText();
  if (!/(^|\.)forwardRef$/.test(expressionText)) return undefined;

  const firstArg = callExpr.getArguments()[0];
  if (!firstArg) return undefined;

  if (Node.isArrowFunction(firstArg)) return firstArg;
  if (Node.isFunctionExpression(firstArg)) return firstArg;

  if (Node.isIdentifier(firstArg)) {
    const declarations = getNodeDefinitions(firstArg).flatMap((definition) => {
      const declarationNode = definition.getDeclarationNode();
      return declarationNode ? [declarationNode] : [];
    });

    for (const declaration of declarations) {
      const resolved = resolveFunctionNode(declaration);
      if (resolved) return resolved;
    }
  }

  return undefined;
}

function resolveFunctionFromCallExpression(
  callExpr: import('ts-morph').CallExpression,
  seen: Set<Node>,
): FunctionLike | undefined {
  return resolveForwardRefFunction(callExpr) ?? resolveReturnedFunctionFromFactoryCall(callExpr, seen);
}

function resolveReturnedFunctionFromFactoryCall(
  callExpr: import('ts-morph').CallExpression,
  seen: Set<Node>,
): FunctionLike | undefined {
  const expression = callExpr.getExpression();
  if (!Node.isIdentifier(expression)) return undefined;

  for (const definition of getNodeDefinitions(expression)) {
    const declaration = definition.getDeclarationNode();
    if (!declaration) continue;

    const resolved = resolveReturnedFunctionFromDeclaration(declaration, seen);
    if (resolved) return resolved;
  }

  return undefined;
}

function resolveReturnedFunctionFromDeclaration(node: Node, seen: Set<Node>): FunctionLike | undefined {
  if (seen.has(node)) return undefined;
  seen.add(node);

  if (Node.isVariableDeclaration(node)) {
    const initializer = node.getInitializer();
    if (!initializer) return undefined;

    if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
      return resolveReturnedFunctionFromCallable(initializer, seen);
    }

    if (Node.isCallExpression(initializer)) {
      return resolveFunctionFromCallExpression(initializer, seen);
    }

    return undefined;
  }

  if (Node.isFunctionDeclaration(node) || Node.isFunctionExpression(node) || Node.isArrowFunction(node)) {
    return resolveReturnedFunctionFromCallable(node, seen);
  }

  return undefined;
}

function resolveReturnedFunctionFromCallable(
  fn: FunctionDeclaration | FunctionExpression | ArrowFunction,
  seen: Set<Node>,
): FunctionLike | undefined {
  const body = fn.getBody();
  if (!body) return undefined;

  if (!Node.isBlock(body)) {
    return resolveReturnedFunctionFromExpression(body, seen);
  }

  for (const statement of body.getStatements()) {
    if (!Node.isReturnStatement(statement)) continue;
    const expression = statement.getExpression();
    if (!expression) continue;

    const resolved = resolveReturnedFunctionFromExpression(expression, seen);
    if (resolved) return resolved;
  }

  return undefined;
}

function resolveReturnedFunctionFromExpression(node: Node, seen: Set<Node>): FunctionLike | undefined {
  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) return node;

  if (Node.isParenthesizedExpression(node)) {
    return resolveReturnedFunctionFromExpression(node.getExpression(), seen);
  }

  if (Node.isCallExpression(node)) {
    return resolveFunctionFromCallExpression(node, seen);
  }

  if (Node.isIdentifier(node)) {
    for (const definition of getNodeDefinitions(node)) {
      const declaration = definition.getDeclarationNode();
      if (!declaration) continue;

      const resolved = resolveReturnedFunctionFromDeclaration(declaration, seen);
      if (resolved) return resolved;
    }
  }

  return undefined;
}
