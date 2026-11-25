import { Node, SyntaxKind, type ClassDeclaration } from 'ts-morph';
import { getJsxTagNameNode, isIntrinsicJsxElement } from '../../shared/helpers/tsx-shared.js';

export function parseAllowedValues(typeText: string): string[] | undefined {
  const literalPattern = /^'[^']*'(?:\s*\|\s*'[^']*')+$/;
  if (!literalPattern.test(typeText.trim())) return undefined;

  const values = typeText
    .split('|')
    .map((v) => v.trim().replace(/^'|'$/g, ''))
    .filter(Boolean)
    .sort();

  return values.length >= 2 ? values : undefined;
}

export function collectDomAttributePropNames(classDecl: ClassDeclaration, propNames: Set<string>): Set<string> {
  const domAttributeProps = new Set<string>();
  const renderMethod = classDecl.getMethod('render');
  if (!renderMethod) return domAttributeProps;

  for (const attribute of renderMethod.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const tagName = getJsxTagNameNode(attribute)?.getText();
    const attributeName = attribute.getNameNode().getText();
    if (!tagName || !propNames.has(attributeName) || !isIntrinsicJsxElement(tagName)) continue;

    const initializer = attribute.getInitializer();
    if (!initializer || !Node.isJsxExpression(initializer)) continue;
    const expression = initializer.getExpression();
    if (!expression || !Node.isPropertyAccessExpression(expression)) continue;
    if (!Node.isThisExpression(expression.getExpression())) continue;
    if (expression.getName() !== attributeName) continue;

    domAttributeProps.add(attributeName);
  }

  return domAttributeProps;
}
