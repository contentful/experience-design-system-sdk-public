import { Node, type PropertyDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../../types/component.js';
import { resolvePropType } from './resolve-prop-type.js';

/**
 * Handle the two signal-input forms:
 *   foo = input<T>(default?, { alias, transform }?)
 *   foo = input.required<T>({ alias, transform }?)
 *
 * The default lives on the first positional arg to `input()` (not on the
 * class field itself — the field stores the InputSignal instance).
 * `input.required()` has no positional default.
 *
 * Returns `null` when the initializer isn't a recognized `input()` call.
 */
export function extractSignalInput(field: PropertyDeclaration): RawPropDefinition | null {
  const init = field.getInitializer();
  if (!init || !Node.isCallExpression(init)) return null;

  const callee = init.getExpression();
  // input(...)
  let required = false;
  if (Node.isIdentifier(callee)) {
    if (callee.getText() !== 'input') return null;
  } else if (Node.isPropertyAccessExpression(callee)) {
    // input.required(...)
    const left = callee.getExpression();
    const right = callee.getName();
    if (!Node.isIdentifier(left) || left.getText() !== 'input' || right !== 'required') return null;
    required = true;
  } else {
    return null;
  }

  const fieldName = field.getName();
  const args = init.getArguments();

  let defaultValue: string | undefined;
  let configArg: Node | undefined;
  if (required) {
    // input.required<T>(opts?)
    configArg = args[0];
  } else {
    // input<T>(default?, opts?)
    const first = args[0];
    if (first) {
      defaultValue = first.getText();
      configArg = args[1];
    }
  }

  let alias: string | null = null;
  let transformIsBoolean = false;
  let transformIsNumber = false;
  if (configArg && Node.isObjectLiteralExpression(configArg)) {
    const aliasProp = configArg.getProperty('alias');
    if (aliasProp && Node.isPropertyAssignment(aliasProp)) {
      const aliasInit = aliasProp.getInitializer();
      if (aliasInit && (Node.isStringLiteral(aliasInit) || Node.isNoSubstitutionTemplateLiteral(aliasInit))) {
        alias = aliasInit.getLiteralText();
      }
    }
    const transformProp = configArg.getProperty('transform');
    if (transformProp && Node.isPropertyAssignment(transformProp)) {
      const transformText = transformProp.getInitializer()?.getText() ?? '';
      if (/\bbooleanAttribute\b/.test(transformText)) transformIsBoolean = true;
      if (/\bnumberAttribute\b/.test(transformText)) transformIsNumber = true;
    }
  }

  // Type comes from the generic: input<string>()  — ts-morph exposes it via getTypeArguments
  const typeArg = init.getTypeArguments()[0];
  const resolved = resolvePropType(typeArg);
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
