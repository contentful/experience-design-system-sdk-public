import { Node } from 'ts-morph';
import type { RawPropDefinition } from '../../../types/component.js';
import {
  extractAllowedValues,
  getTypeReferenceName,
  getValueTargetDeclarations,
} from '../../shared/helpers/tsx-shared.js';
import {
  resolveReturnedObjectLiteral,
  resolveObjectLiteralFromCallExpression,
  getExpressionTerminalName,
  extractStringArrayLiteralValues,
} from './resolve-ast-object.js';

const VUE_PROP_VALUE_TYPE_MAP: Record<string, string> = {
  String: 'string',
  Number: 'number',
  Boolean: 'boolean',
  Array: 'any[]',
  Object: 'object',
  Function: 'function',
};

function extractPropTypeArgument(typeNode: Node | undefined): string | undefined {
  if (!typeNode || !Node.isTypeReference(typeNode)) return undefined;
  if (getTypeReferenceName(typeNode) !== 'PropType') return undefined;
  return typeNode.getTypeArguments()[0]?.getText();
}

function resolveVueTsxPropType(node: Node): string {
  if (Node.isAsExpression(node) || Node.isTypeAssertion(node)) {
    const typeNode = node.getTypeNode();
    const propTypeArg = extractPropTypeArgument(typeNode);
    if (propTypeArg) return propTypeArg;
    return resolveVueTsxPropType(node.getExpression());
  }

  if (Node.isParenthesizedExpression(node)) {
    return resolveVueTsxPropType(node.getExpression());
  }

  if (Node.isArrayLiteralExpression(node)) {
    const memberTypes = node.getElements().flatMap((element) => {
      const memberType = resolveVueTsxPropType(element);
      return memberType === 'any' ? [] : [memberType];
    });
    return memberTypes.length > 0 ? [...new Set(memberTypes)].sort().join(' | ') : 'any';
  }

  if (Node.isIdentifier(node)) {
    return VUE_PROP_VALUE_TYPE_MAP[node.getText()] ?? node.getText();
  }

  if (Node.isNullLiteral(node)) return 'any';

  return node.getType().getText(node);
}

function readVueTsxObjectPropertyName(property: import('ts-morph').PropertyAssignment): string | undefined {
  const nameNode = property.getNameNode();
  if (Node.isIdentifier(nameNode) || Node.isPrivateIdentifier(nameNode)) return nameNode.getText();
  if (Node.isStringLiteral(nameNode) || Node.isNoSubstitutionTemplateLiteral(nameNode)) return nameNode.getLiteralText();
  if (Node.isComputedPropertyName(nameNode)) {
    const expression = nameNode.getExpression();
    if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
      return expression.getLiteralText();
    }
  }
  return property.getName();
}

function buildPropFromObjectLiteral(
  propName: string,
  initializer: import('ts-morph').ObjectLiteralExpression,
): RawPropDefinition {
  let type = 'any';
  let required = false;
  let defaultValue: string | undefined;
  let allowedValues: string[] | undefined;

  for (const property of initializer.getProperties()) {
    if (!Node.isPropertyAssignment(property)) continue;
    const name = property.getName();
    const value = property.getInitializer();
    if (!value) continue;

    if (name === 'type') {
      type = resolveVueTsxPropType(value);
      allowedValues = extractAllowedValues(value.getType());
    } else if (name === 'required') {
      required = value.getText() === 'true';
    } else if (name === 'default') {
      defaultValue = value.getText();
    }
  }

  return {
    name: propName,
    type,
    required,
    ...(defaultValue !== undefined && { defaultValue }),
    ...(allowedValues && { allowedValues }),
  };
}

function buildPropFromInitializer(propName: string, initializer: Node | undefined): RawPropDefinition | undefined {
  if (!initializer) return undefined;
  if (Node.isObjectLiteralExpression(initializer)) {
    return buildPropFromObjectLiteral(propName, initializer);
  }
  return { name: propName, type: resolveVueTsxPropType(initializer), required: false };
}

function extractPropsFromObjectLiteral(
  objectLiteral: import('ts-morph').ObjectLiteralExpression,
  seen: Set<Node>,
): RawPropDefinition[] {
  const propsByName = new Map<string, RawPropDefinition>();

  for (const property of objectLiteral.getProperties()) {
    if (Node.isPropertyAssignment(property)) {
      const propName = readVueTsxObjectPropertyName(property);
      if (!propName) continue;
      const definition = buildPropFromInitializer(propName, property.getInitializer());
      if (definition) propsByName.set(definition.name, definition);
      continue;
    }

    if (Node.isSpreadAssignment(property)) {
      for (const definition of extractPropsFromExpression(property.getExpression(), seen)) {
        propsByName.set(definition.name, definition);
      }
    }
  }

  return [...propsByName.values()];
}

function resolvePropsObjectLiteral(node: Node): import('ts-morph').ObjectLiteralExpression | undefined {
  if (Node.isObjectLiteralExpression(node)) return node;

  if (!Node.isCallExpression(node)) return undefined;

  const returnedObject = resolveObjectLiteralFromCallExpression(node, new Set<Node>());
  if (returnedObject) return returnedObject;

  const expression = node.getExpression();
  if (Node.isIdentifier(expression)) {
    for (const declaration of getValueTargetDeclarations(expression)) {
      if (!Node.isVariableDeclaration(declaration)) continue;
      const initializer = declaration.getInitializer();
      if (!initializer || !Node.isCallExpression(initializer)) continue;
      if (!/(^|\.)propsFactory$/.test(initializer.getExpression().getText())) continue;
      const propsArg = initializer.getArguments()[0];
      if (propsArg && Node.isObjectLiteralExpression(propsArg)) return propsArg;
    }
  }

  return undefined;
}

export function extractPropsFromExpression(node: Node, seen: Set<Node>): RawPropDefinition[] {
  if (seen.has(node)) return [];
  seen.add(node);

  if (Node.isObjectLiteralExpression(node)) {
    return extractPropsFromObjectLiteral(node, seen);
  }

  if (Node.isCallExpression(node)) {
    const expressionName = getExpressionTerminalName(node.getExpression());
    if (expressionName === 'pick' || expressionName === 'omit') {
      const sourceArg = node.getArguments()[0];
      const keyArg = node.getArguments()[1];
      if (!sourceArg || !keyArg) return [];
      const keys = extractStringArrayLiteralValues(keyArg);
      if (!keys) return [];
      const sourceProps = extractPropsFromExpression(sourceArg, seen);
      const keySet = new Set(keys);
      return sourceProps.filter((p) => (expressionName === 'pick' ? keySet.has(p.name) : !keySet.has(p.name)));
    }

    const propsObject = resolvePropsObjectLiteral(node);
    if (propsObject) return extractPropsFromObjectLiteral(propsObject, seen);
  }

  if (Node.isIdentifier(node)) {
    for (const declaration of getValueTargetDeclarations(node)) {
      const resolved = resolveReturnedObjectLiteral(declaration, seen);
      if (resolved) return extractPropsFromObjectLiteral(resolved, seen);
    }
  }

  return [];
}

/** Extracts all props from a `defineComponent({ props: ... })` options object. */
export function extractVueTsxComponentProps(
  options: import('ts-morph').ObjectLiteralExpression,
): RawPropDefinition[] {
  const propsProp = options.getProperty('props');
  if (!propsProp || !Node.isPropertyAssignment(propsProp)) return [];
  const initializer = propsProp.getInitializer();
  if (!initializer) return [];
  return extractPropsFromExpression(initializer, new Set<Node>()).sort((a, b) => a.name.localeCompare(b.name));
}
