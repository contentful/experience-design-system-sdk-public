import { Node, SyntaxKind, type ParameterDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../types/component.js';
import { getSourceLineMetadata } from '../../shared/helpers/get-node-source-lines.js';
import type { FunctionLike } from './resolve-component-function.js';

export function extractDestructuredBindingFallbackProps(
  func: FunctionLike,
  param: ParameterDeclaration,
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

      const propName = getBindingPropertyName(element);
      if (propName === undefined || propName === 'children' || slotNames.has(propName)) continue;
      if (propsByName.has(propName)) continue;

      const property = paramType.getProperty(propName);
      const declaration = property?.getValueDeclaration() ?? property?.getDeclarations()[0];
      const propertyType =
        property && declaration ? property.getTypeAtLocation(declaration).getText(declaration) : 'any';

      propsByName.set(propName, {
        name: propName,
        type: propertyType === 'unknown' ? 'any' : propertyType,
        required: property ? !property.isOptional() : false,
        ...(element.getInitializer() ? { defaultValue: element.getInitializer()!.getText() } : {}),
        ...getSourceLineMetadata(declaration),
      });
    }
  }

  return [...propsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function getBindingPropertyName(element: import('ts-morph').BindingElement): string | undefined {
  const propertyName = element.getPropertyNameNode();
  const name = propertyName ?? element.getNameNode();
  if (Node.isIdentifier(name)) return name.getText();
  if (Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name)) return name.getLiteralValue();
  if (Node.isNumericLiteral(name)) return String(name.getLiteralValue());
  if (Node.isComputedPropertyName(name)) {
    const expression = name.getExpression();
    if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression))
      return expression.getLiteralValue();
    if (Node.isNumericLiteral(expression)) return String(expression.getLiteralValue());
  }
  return undefined;
}
