import { Node, type PropertyDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../../types/component.js';
import type { ExtractedInput } from '../../types/extracted-input.js';
import { resolvePropType } from './resolve-prop-type.js';

export function extractSignalInput(field: PropertyDeclaration): ExtractedInput | null {
  const init = field.getInitializer();
  if (!init || !Node.isCallExpression(init)) return null;

  const callee = init.getExpression();

  let required = false;
  if (Node.isIdentifier(callee)) {
    if (callee.getText() !== 'input') return null;
  } else if (Node.isPropertyAccessExpression(callee)) {
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
    configArg = args[0];
  } else {
    const first = args[0];
    if (first) {
      defaultValue = first.getText();
      configArg = args[1];
    }
  }

  let alias: string | null = null;
  let transform: string | undefined;
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
      transform = transformProp.getInitializer()?.getText();
    }
  }

  const typeArg = init.getTypeArguments()[0];
  const resolved = resolvePropType(typeArg);

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
