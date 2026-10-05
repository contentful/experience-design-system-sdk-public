import { Node, type ClassDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../model/component.js';

function kebabToCamel(input: string): string {
  return input.replace(/-([a-z0-9])/gi, (_, char: string) => char.toUpperCase());
}

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

function getExplicitLitPropertyAttributeName(property: import('ts-morph').PropertyDeclaration): string | null {
  const decorator = property.getDecorators().find((candidate) => candidate.getName() === 'property');
  const firstArg = decorator?.getArguments()[0];
  if (!firstArg || !Node.isObjectLiteralExpression(firstArg)) return null;

  const attributeProp = firstArg.getProperty('attribute');
  if (!attributeProp || !Node.isPropertyAssignment(attributeProp)) return null;

  const initializer = attributeProp.getInitializer();
  if (!initializer || !Node.isStringLiteral(initializer)) return null;

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

    if (!hasDecorators && initializer && Node.isArrowFunction(initializer)) continue;

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
      defaultValue = Node.isStringLiteral(initializer) ? initializer.getLiteralValue() : initializer.getText();
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
