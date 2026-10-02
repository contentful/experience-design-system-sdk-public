import { Node, type ClassDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../model/component.js';

function kebabToCamel(input: string): string {
  return input.replace(/-([a-z0-9])/gi, (_, char: string) => char.toUpperCase());
}

export function extractObservedAttributes(classDecl: ClassDeclaration): RawPropDefinition[] {
  const props: RawPropDefinition[] = [];

  const getter = classDecl.getGetAccessor('observedAttributes');
  if (!getter || !getter.isStatic()) return props;

  const body = getter.getBody();
  if (!body) return props;

  // Find the return statement containing an array literal
  body.forEachDescendant((node) => {
    if (!Node.isReturnStatement(node)) return;

    const expression = node.getExpression();
    if (!expression || !Node.isArrayLiteralExpression(expression)) return;

    for (const element of expression.getElements()) {
      if (Node.isStringLiteral(element)) {
        const attrName = element.getLiteralValue();
        props.push({
          name: attrName,
          type: 'string',
          required: false,
        });
      }
    }
  });

  return props;
}

function hasInternalJsDocTag(member: { getJsDocs(): import('ts-morph').JSDoc[] }): boolean {
  return member.getJsDocs().some((doc) => doc.getTags().some((tag) => tag.getTagName() === 'internal'));
}

const NON_PUBLIC_LIT_DECORATORS = new Set(['consume', 'provide', 'query', 'queryAsync', 'state']);
const INTERNAL_RUNTIME_FIELD_NAMES = new Set(['dir', 'initialReflectedProperties', 'lang']);

function isNonPublicLitMember(member: { getDecorators(): import('ts-morph').Decorator[] }): boolean {
  return member.getDecorators().some((decorator) => NON_PUBLIC_LIT_DECORATORS.has(decorator.getName()));
}

export function hasShoelaceRuntimeBookkeepingField(classDecl: ClassDeclaration): boolean {
  return classDecl.getProperties().some((property) => property.getName() === 'initialReflectedProperties');
}

function isInternalRuntimeField(name: string, applyRuntimeFieldDenylist: boolean): boolean {
  return applyRuntimeFieldDenylist && INTERNAL_RUNTIME_FIELD_NAMES.has(name);
}

function getExplicitLitPropertyAttributeName(property: import('ts-morph').PropertyDeclaration): string | null {
  const decorator = property.getDecorators().find((candidate) => candidate.getName() === 'property');
  const firstArg = decorator?.getArguments()[0];
  if (!firstArg || !Node.isObjectLiteralExpression(firstArg)) {
    return null;
  }

  const attributeProp = firstArg.getProperty('attribute');
  if (!attributeProp || !Node.isPropertyAssignment(attributeProp)) {
    return null;
  }

  const initializer = attributeProp.getInitializer();
  if (!initializer || !Node.isStringLiteral(initializer)) {
    return null;
  }

  return initializer.getLiteralValue();
}

export function extractClassProperties(
  classDecl: ClassDeclaration,
  applyRuntimeFieldDenylist = false,
): RawPropDefinition[] {
  const props: RawPropDefinition[] = [];

  for (const property of classDecl.getProperties()) {
    if (property.isStatic()) continue;
    if (hasInternalJsDocTag(property)) continue;
    if (isNonPublicLitMember(property)) continue;

    const name = property.getName();
    if (name.startsWith('#') || isInternalRuntimeField(name, applyRuntimeFieldDenylist)) continue;
    const scope = property.getScope();
    if (scope === 'private' || scope === 'protected') continue;

    const initializer = property.getInitializer();
    const hasDecorators = property.getDecorators().length > 0;

    // Skip undecorated arrow-function properties (internal event handlers / callbacks)
    if (!hasDecorators && initializer && Node.isArrowFunction(initializer)) {
      continue;
    }

    // Skip properties initialized with this.attachInternals() (ElementInternals)
    if (
      initializer &&
      Node.isCallExpression(initializer) &&
      initializer.getExpression().getText() === 'this.attachInternals'
    ) {
      continue;
    }

    const typeNode = property.getTypeNode();
    const type = typeNode ? typeNode.getText() : 'any';
    const publicName = name.startsWith('_') && hasDecorators ? getExplicitLitPropertyAttributeName(property) : null;

    let defaultValue: string | undefined;

    if (initializer) {
      if (Node.isStringLiteral(initializer)) {
        defaultValue = initializer.getLiteralValue();
      } else {
        defaultValue = initializer.getText();
      }
    }

    props.push({
      name: publicName ? kebabToCamel(publicName) : name,
      type,
      required: false,
      ...(defaultValue !== undefined && { defaultValue }),
      sourceStartLine: property.getStartLineNumber(),
      sourceEndLine: property.getEndLineNumber(),
    });
  }

  return props;
}

export function extractAccessorProperties(
  classDecl: ClassDeclaration,
  applyRuntimeFieldDenylist = false,
): RawPropDefinition[] {
  const props: RawPropDefinition[] = [];
  const accessors = new Map<
    string,
    {
      getter?: ReturnType<ClassDeclaration['getGetAccessor']>;
      setter?: ReturnType<ClassDeclaration['getSetAccessor']>;
    }
  >();

  for (const getter of classDecl.getGetAccessors()) {
    if (getter.isStatic()) continue;
    if (hasInternalJsDocTag(getter)) continue;
    if (isNonPublicLitMember(getter)) continue;

    const name = getter.getName();
    if (
      name === 'observedAttributes' ||
      name === 'template' ||
      name.startsWith('#') ||
      isInternalRuntimeField(name, applyRuntimeFieldDenylist)
    )
      continue;

    const scope = getter.getScope();
    if (scope === 'private' || scope === 'protected') continue;

    const entry = accessors.get(name) ?? {};
    entry.getter = getter;
    accessors.set(name, entry);
  }

  for (const setter of classDecl.getSetAccessors()) {
    if (setter.isStatic()) continue;
    if (hasInternalJsDocTag(setter)) continue;
    if (isNonPublicLitMember(setter)) continue;

    const name = setter.getName();
    if (
      name === 'observedAttributes' ||
      name === 'template' ||
      name.startsWith('#') ||
      isInternalRuntimeField(name, applyRuntimeFieldDenylist)
    )
      continue;

    const scope = setter.getScope();
    if (scope === 'private' || scope === 'protected') continue;

    const entry = accessors.get(name) ?? {};
    entry.setter = setter;
    accessors.set(name, entry);
  }

  for (const [name, { getter, setter }] of accessors) {
    const hasPropertyDecorator =
      getter?.getDecorators().some((decorator) => decorator.getName() === 'property') ||
      setter?.getDecorators().some((decorator) => decorator.getName() === 'property');
    if (!hasPropertyDecorator && !(getter && setter)) continue;

    const type =
      getter?.getReturnTypeNode()?.getText() ?? setter?.getParameters()[0]?.getTypeNode()?.getText() ?? 'any';

    const accessorNode = getter ?? setter;
    props.push({
      name,
      type,
      required: false,
      ...(accessorNode
        ? {
            sourceStartLine: accessorNode.getStartLineNumber(),
            sourceEndLine: accessorNode.getEndLineNumber(),
          }
        : {}),
    });
  }

  return props;
}

export function extractJsDocAttributeProps(classDecl: ClassDeclaration): RawPropDefinition[] {
  const props: RawPropDefinition[] = [];

  for (const doc of classDecl.getJsDocs()) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() !== 'attribute') continue;

      const tagComment = tag.getCommentText();
      const normalizedComment = Array.isArray(tagComment) ? tagComment.join(' ') : tagComment;
      const match = normalizedComment?.match(/(?:\{([^}]+)\}\s+)?([^\s]+)(?:\s*-\s*([\s\S]*))?/);
      if (!match) continue;

      const [, type, name, description] = match;
      if (!name || name.startsWith('#')) continue;

      props.push({
        name,
        type: type?.trim() || 'any',
        required: false,
        ...(description ? { description: description.replace(/\s+/g, ' ').trim() } : {}),
      });
    }
  }

  return props;
}

export function mergePropLists(...propLists: RawPropDefinition[][]): RawPropDefinition[] {
  const merged = new Map<string, RawPropDefinition>();

  for (const propList of propLists) {
    for (const prop of propList) {
      merged.set(prop.name, prop);
    }
  }

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function mergeProps(observed: RawPropDefinition[], classProps: RawPropDefinition[]): RawPropDefinition[] {
  return mergePropLists(observed, classProps);
}
