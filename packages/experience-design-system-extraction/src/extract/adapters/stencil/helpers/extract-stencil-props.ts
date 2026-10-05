import { Node, type ClassDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../model/component.js';
import { hasPropertyDecorator } from './detect-stencil-class.js';
import { parseAllowedValues, collectDomAttributePropNames } from './stencil-prop-helpers.js';

export { parseAllowedValues, collectDomAttributePropNames } from './stencil-prop-helpers.js';

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
          if (tagComment && !description) description = tagComment;
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
