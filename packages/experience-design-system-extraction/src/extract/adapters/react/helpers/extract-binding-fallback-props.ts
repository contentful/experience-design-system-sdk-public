import { Node, SyntaxKind, type ParameterDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../model/component.js';
import { getSourceLineMetadata } from '../../support/resolution/source-location.js';
import type { FunctionLike } from '../function-resolution.js';

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
