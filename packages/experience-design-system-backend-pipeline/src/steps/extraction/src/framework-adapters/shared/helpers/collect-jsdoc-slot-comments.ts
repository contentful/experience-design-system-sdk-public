import type { ClassDeclaration } from 'ts-morph';

export function collectJsDocSlotComments(classDecl: ClassDeclaration): string[] {
  const comments: string[] = [];
  for (const jsDoc of classDecl.getJsDocs()) {
    for (const tag of jsDoc.getTags()) {
      if (tag.getTagName() !== 'slot') continue;
      const comment = tag.getCommentText()?.trim();
      if (comment) comments.push(comment);
    }
  }
  return comments;
}
