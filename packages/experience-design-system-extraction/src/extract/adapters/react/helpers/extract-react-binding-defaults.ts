import { Node } from 'ts-morph';
import type { FunctionLike } from '../function-resolution.js';

export { isImplementationOnlyAliasProp, filterImplementationOnlyAliasProps } from './filter-impl-alias-props.js';
export { extractDestructuredBindingFallbackProps } from './extract-binding-fallback-props.js';

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
