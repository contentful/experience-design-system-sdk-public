import { Node, type GetAccessorDeclaration, type PropertyDeclaration, type SetAccessorDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../../types/component.js';
import { resolvePropType } from './resolve-prop-type.js';

/**
 * Handle the three decorator forms:
 *   @Input() foo
 *   @Input('alias') foo
 *   @Input({ required, transform, alias }) foo
 *
 * And both accessor forms (Angular treats @Input on get and set as equivalent):
 *   @Input() set foo(v: string) { ... }
 *   @Input() get foo(): string { ... }
 *
 * Returns `null` when the property has no `@Input()` decorator.
 */
export function extractDecoratorInput(
  field: PropertyDeclaration | SetAccessorDeclaration | GetAccessorDeclaration,
): RawPropDefinition | null {
  const decorator = field.getDecorator('Input');
  if (!decorator) return null;

  const fieldName = field.getName();
  const args = decorator.getArguments();

  let alias: string | null = null;
  let required = false;
  let transformIsBoolean = false;
  let transformIsNumber = false;

  if (args.length === 1) {
    const arg = args[0]!;
    if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) {
      // @Input('alias') foo
      alias = arg.getLiteralText();
    } else if (Node.isObjectLiteralExpression(arg)) {
      // @Input({ alias, required, transform }) foo
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
        const transformText = transformProp.getInitializer()?.getText() ?? '';
        if (/\bbooleanAttribute\b/.test(transformText)) transformIsBoolean = true;
        if (/\bnumberAttribute\b/.test(transformText)) transformIsNumber = true;
      }
    }
  }

  // Pick the type node + default
  let typeNode;
  let defaultValue: string | undefined;
  if (Node.isSetAccessorDeclaration(field)) {
    const param = field.getParameters()[0];
    typeNode = param?.getTypeNode();
  } else if (Node.isGetAccessorDeclaration(field)) {
    // Prefer the companion setter's parameter type when available (that's the
    // input shape the user writes to); fall back to the getter's return type.
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
  const typeText = transformIsBoolean ? 'boolean' : transformIsNumber ? 'number' : resolved.text;

  const name = alias ?? fieldName;

  const prop: RawPropDefinition = {
    name,
    type: typeText,
    required,
    sourceStartLine: field.getStartLineNumber(),
    sourceEndLine: field.getEndLineNumber(),
  };
  if (defaultValue !== undefined) prop.defaultValue = defaultValue;
  if (resolved.allowedValues && !transformIsBoolean && !transformIsNumber) {
    prop.allowedValues = resolved.allowedValues;
  }
  return prop;
}
