import { Node, SyntaxKind, type ClassDeclaration } from 'ts-morph';
import { getJsxTagNameNode, isIntrinsicJsxElement } from '../../support/tsx-shared.js';

/** Parses string literal union type text and returns the sorted values, or undefined if not a literal union. */
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

/** Finds @Prop-decorated properties that are forwarded directly to intrinsic DOM attributes. */
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
