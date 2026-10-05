import { Node, SyntaxKind, type ParameterDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../model/component.js';
import { getSourceLineMetadata } from '../../support/resolution/source-location.js';
import type { FunctionLike } from '../function-resolution.js';

export function recordBindingPatternDefaults(nameNode: Node, defaults: Map<string, string>): void {
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

export function extractDefaultValues(func: FunctionLike): Map<string, string> {
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

export function isImplementationOnlyAliasProp(func: FunctionLike, propName: string): boolean {
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
    if (bindingElement?.getNameNode() === node) continue;

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

export function filterImplementationOnlyAliasProps(
  props: RawPropDefinition[],
  func: FunctionLike,
): RawPropDefinition[] {
  const publicPropNames = new Set(props.filter((prop) => !prop.name.startsWith('_')).map((prop) => prop.name));

  return props.filter((prop) => {
    if (/^__scope[A-Z]/.test(prop.name)) return false;
    if (prop.name.startsWith('_') && publicPropNames.has(prop.name.slice(1))) return false;
    return !isImplementationOnlyAliasProp(func, prop.name);
  });
}

export function extractDestructuredBindingFallbackProps(
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
        ...getSourceLineMetadata(declaration),
      });
    }
  }

  return [...propsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}
