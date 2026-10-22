import { Node } from 'ts-morph';
import type { FunctionLike } from './resolve-component-function.js';

export { extractDestructuredBindingFallbackProps } from './extract-binding-fallback-props.js';

function recordBindingPatternDefaults(nameNode: Node, defaults: Map<string, string>): void {
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

/** Preserve the original binding initializer text for source evidence; authoring display keeps its existing normalization. */
export function extractSourceDefaultExpressions(func: FunctionLike): Map<string, string> {
  return new Map([...extractSourceDefaultNodes(func)].map(([key, node]) => [key, node.getText()]));
}

export function extractSourceDefaultNodes(func: FunctionLike): Map<string, Node> {
  const defaults = new Map<string, Node>();
  const params = func.getParameters();
  if (params.length === 0) return defaults;
  const nameNode = params[0]!.getNameNode();
  const patterns: import('ts-morph').ObjectBindingPattern[] = [];
  if (Node.isObjectBindingPattern(nameNode)) {
    patterns.push(nameNode);
  } else if (Node.isIdentifier(nameNode)) {
    const body = func.getBody();
    if (body && Node.isBlock(body)) {
      for (const statement of body.getStatements()) {
        if (!Node.isVariableStatement(statement)) continue;
        for (const declaration of statement.getDeclarationList().getDeclarations()) {
          const declarationName = declaration.getNameNode();
          const initializer = declaration.getInitializer();
          if (
            Node.isObjectBindingPattern(declarationName) &&
            initializer &&
            Node.isIdentifier(initializer) &&
            initializer.getText() === nameNode.getText()
          )
            patterns.push(declarationName);
        }
      }
    }
  }
  for (const pattern of patterns) {
    for (const element of pattern.getElements()) {
      const initializer = element.getInitializer();
      const propertyName = element.getPropertyNameNode();
      const keyNode = propertyName ?? element.getNameNode();
      const key = Node.isIdentifier(keyNode)
        ? keyNode.getText()
        : Node.isStringLiteral(keyNode) || Node.isNoSubstitutionTemplateLiteral(keyNode)
          ? keyNode.getLiteralValue()
          : Node.isNumericLiteral(keyNode)
            ? String(keyNode.getLiteralValue())
            : Node.isComputedPropertyName(keyNode) &&
                (Node.isStringLiteral(keyNode.getExpression()) ||
                  Node.isNoSubstitutionTemplateLiteral(keyNode.getExpression()) ||
                  Node.isNumericLiteral(keyNode.getExpression()))
              ? keyNode
                  .getExpression()
                  .getText()
                  .replace(/^['"]|['"]$/g, '')
              : undefined;
      if (initializer && key !== undefined) defaults.set(key, initializer);
    }
  }
  return defaults;
}
