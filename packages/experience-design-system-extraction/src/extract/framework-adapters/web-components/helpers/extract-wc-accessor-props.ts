import { type ClassDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../types/component.js';

function hasInternalJsDocTag(member: { getJsDocs(): import('ts-morph').JSDoc[] }): boolean {
  return member.getJsDocs().some((doc) => doc.getTags().some((tag) => tag.getTagName() === 'internal'));
}

const NON_PUBLIC_LIT_DECORATORS = new Set(['consume', 'provide', 'query', 'queryAsync', 'state']);
const INTERNAL_RUNTIME_FIELD_NAMES = new Set(['dir', 'initialReflectedProperties', 'lang']);

function isNonPublicLitMember(member: { getDecorators(): import('ts-morph').Decorator[] }): boolean {
  return member.getDecorators().some((decorator) => NON_PUBLIC_LIT_DECORATORS.has(decorator.getName()));
}

function isInternalRuntimeField(name: string, applyRuntimeFieldDenylist: boolean): boolean {
  return applyRuntimeFieldDenylist && INTERNAL_RUNTIME_FIELD_NAMES.has(name);
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
