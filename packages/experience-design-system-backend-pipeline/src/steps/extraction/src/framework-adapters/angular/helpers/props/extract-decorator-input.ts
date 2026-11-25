import { Node, type GetAccessorDeclaration, type PropertyDeclaration, type SetAccessorDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../../types/component.js';
import type { ExtractedInput } from '../../types/extracted-input.js';
import { resolvePropType } from './resolve-prop-type.js';

export function extractDecoratorInput(
  field: PropertyDeclaration | SetAccessorDeclaration | GetAccessorDeclaration,
): ExtractedInput | null {
  const decorator = field.getDecorator('Input');
  if (!decorator) return null;

  const fieldName = field.getName();
  const args = decorator.getArguments();

  let alias: string | null = null;
  let required = false;
  let transform: string | undefined;

  if (args.length === 1) {
    const arg = args[0]!;
    if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
      alias = arg.getLiteralText();
    } else if (Node.isObjectLiteralExpression(arg)) {
      const aliasProp = arg.getProperty('alias');
      if (aliasProp && Node.isPropertyAssignment(aliasProp)) {
        const init = aliasProp.getInitializer();
        if (init && (Node.isStringLiteral(init) || Node.isNoSubstitutionTemplateLiteral(init))) {
          alias = init.getLiteralText();
        }
      }
      const requiredProp = arg.getProperty('required');
      if (requiredProp && Node.isPropertyAssignment(requiredProp)) {
        const init = requiredProp.getInitializer();
        if (init?.getText() === 'true') required = true;
      }
      const transformProp = arg.getProperty('transform');
      if (transformProp && Node.isPropertyAssignment(transformProp)) {
        transform = transformProp.getInitializer()?.getText();
      }
    }
  }

  let typeNode;
  let defaultValue: string | undefined;
  if (Node.isSetAccessorDeclaration(field)) {
    const param = field.getParameters()[0];
    typeNode = param?.getTypeNode();
  } else if (Node.isGetAccessorDeclaration(field)) {
    const parent = field.getParent();
    const companionSetter = parent && Node.isClassDeclaration(parent) ? parent.getSetAccessor(fieldName) : undefined;
    if (companionSetter) {
      typeNode = companionSetter.getParameters()[0]?.getTypeNode();
    }
    if (!typeNode) typeNode = field.getReturnTypeNode();
  } else {
    typeNode = field.getTypeNode();
    const initializer = field.getInitializer();
    if (initializer) defaultValue = initializer.getText();
  }

  const resolved = resolvePropType(typeNode);

  const name = alias ?? fieldName;

  const prop: RawPropDefinition = {
    name,
    type: resolved.text,
    required,
    sourceStartLine: field.getStartLineNumber(),
    sourceEndLine: field.getEndLineNumber(),
  };
  if (defaultValue !== undefined) prop.defaultValue = defaultValue;
  if (resolved.allowedValues) {
    prop.allowedValues = resolved.allowedValues;
  }
  return transform === undefined ? { prop } : { prop, transform };
}
