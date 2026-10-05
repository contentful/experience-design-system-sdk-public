import { Node, SyntaxKind, type ClassDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../model/component.js';
import { getJsxTagNameNode, isIntrinsicJsxElement } from '../../support/tsx-shared.js';
import { hasPropertyDecorator } from './detect-stencil-class.js';

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
    if (!tagName || !propNames.has(attributeName) || !isIntrinsicJsxElement(tagName)) {
      continue;
    }

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

/** Extracts all @Prop-decorated properties from a Stencil class as RawPropDefinitions. */
export function extractStencilProps(classDecl: ClassDeclaration): RawPropDefinition[] {
  const props: RawPropDefinition[] = [];
  const propNames = new Set(
    classDecl
      .getProperties()
      .filter((property) => hasPropertyDecorator(property, 'Prop'))
      .map((property) => property.getName()),
  );
  const domAttributePropNames = collectDomAttributePropNames(classDecl, propNames);

  for (const property of classDecl.getProperties()) {
    if (!hasPropertyDecorator(property, 'Prop')) continue;

    const name = property.getName();
    const typeNode = property.getTypeNode();
    const typeText = typeNode ? typeNode.getText() : 'unknown';

    const hasQuestionToken = property.hasQuestionToken();
    const hasExclamation = property.hasExclamationToken();
    const initializer = property.getInitializer();

    let defaultValue: string | undefined;
    if (initializer) {
      defaultValue = Node.isStringLiteral(initializer) ? initializer.getLiteralValue() : initializer.getText();
    }

    const isRequired = hasExclamation || (!hasQuestionToken && !initializer);

    const jsDocs = property.getJsDocs();
    let description: string | undefined;
    let isDeprecated = false;

    if (jsDocs.length > 0) {
      const jsDoc = jsDocs[0];
      description = jsDoc.getDescription().trim() || undefined;

      for (const tag of jsDoc.getTags()) {
        if (tag.getTagName() === 'deprecated') {
          isDeprecated = true;
          const tagComment = tag.getCommentText()?.trim();
          if (tagComment && !description) {
            description = tagComment;
          }
        }
      }
    }

    if (isDeprecated && description) {
      description = `[DEPRECATED] ${description}`;
    } else if (isDeprecated) {
      description = '[DEPRECATED]';
    }

    const allowedValues = parseAllowedValues(typeText);

    props.push({
      name,
      type: typeText,
      required: isRequired,
      ...(defaultValue !== undefined && { defaultValue }),
      ...(description && { description }),
      ...(allowedValues && { allowedValues }),
      ...(domAttributePropNames.has(name) && { domAttribute: true }),
      sourceStartLine: property.getStartLineNumber(),
      sourceEndLine: property.getEndLineNumber(),
    });
  }

  return props.sort((a, b) => a.name.localeCompare(b.name));
}
