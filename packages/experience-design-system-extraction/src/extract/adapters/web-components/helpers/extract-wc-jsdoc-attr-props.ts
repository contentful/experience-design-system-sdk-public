import type { ClassDeclaration } from 'ts-morph';
import type { RawPropDefinition } from '../../../model/component.js';

export function extractJsDocAttributeProps(classDecl: ClassDeclaration): RawPropDefinition[] {
  const props: RawPropDefinition[] = [];

  for (const doc of classDecl.getJsDocs()) {
    for (const tag of doc.getTags()) {
      if (tag.getTagName() !== 'attribute') continue;

      const tagComment = tag.getCommentText();
      const normalizedComment = Array.isArray(tagComment) ? tagComment.join(' ') : tagComment;
      const match = normalizedComment?.match(/(?:\{([^}]+)\}\s+)?([^\s]+)(?:\s*-\s*([\s\S]*))?/);
      if (!match) continue;

      const [, type, name, description] = match;
      if (!name || name.startsWith('#')) continue;

      props.push({
        name,
        type: type?.trim() || 'any',
        required: false,
        ...(description ? { description: description.replace(/\s+/g, ' ').trim() } : {}),
      });
    }
  }

  return props;
}
