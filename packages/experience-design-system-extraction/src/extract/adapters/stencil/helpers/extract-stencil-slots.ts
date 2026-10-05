import { Node, type ClassDeclaration } from 'ts-morph';
import type { RawSlotDefinition } from '../../../model/component.js';

/** Normalises a raw slot name string to a RawSlotDefinition, treating blank/undefined as "default". */
export function parseStencilSlot(name: string | undefined): RawSlotDefinition {
  const normalizedName = name && name.length > 0 ? name : 'default';
  return { name: normalizedName, isDefault: normalizedName === 'default' };
}

/** Extracts all slots from a Stencil class — via @slot JSDoc tags and template <slot> elements. */
export function extractStencilSlots(
  classDecl: ClassDeclaration,
  warnings: string[],
  componentName: string,
): RawSlotDefinition[] {
  const slots = new Map<string, RawSlotDefinition>();

  const upsertSlot = (slot: RawSlotDefinition): void => {
    const existing = slots.get(slot.name);
    if (!existing) {
      slots.set(slot.name, slot);
      return;
    }
    slots.set(slot.name, { ...existing, ...slot, description: existing.description ?? slot.description });
  };

  // JSDoc @slot tags
  for (const jsDoc of classDecl.getJsDocs()) {
    for (const tag of jsDoc.getTags()) {
      if (tag.getTagName() !== 'slot') continue;

      const comment = tag.getCommentText()?.trim();
      if (!comment) continue;

      if (comment.startsWith('{')) {
        try {
          const parsed = JSON.parse(comment) as { name?: string; description?: string; isDeprecated?: boolean };
          const slot = parseStencilSlot(parsed.name);
          let description = parsed.description || undefined;
          if (parsed.isDeprecated && description) {
            description = `[DEPRECATED] ${description}`;
          } else if (parsed.isDeprecated) {
            description = '[DEPRECATED]';
          }
          upsertSlot({ ...slot, ...(description && { description }) });
          continue;
        } catch {
          warnings.push(`Failed to parse @slot JSDoc in ${componentName}: invalid JSON "${comment}"`);
          continue;
        }
      }

      const match = comment.match(/^(?:(\S+)\s*-\s*)?(.*)$/s);
      if (!match) continue;
      const [, rawName, rawDescription] = match;
      const slot = parseStencilSlot(rawName);
      const description = rawDescription.trim() || undefined;
      upsertSlot({ ...slot, ...(description && { description }) });
    }
  }

  // Template <slot> elements
  for (const method of classDecl.getMethods()) {
    method.forEachDescendant((node) => {
      if (!Node.isJsxSelfClosingElement(node) && !Node.isJsxElement(node)) return;

      const openingElement = Node.isJsxElement(node) ? node.getOpeningElement() : node;
      const tagName = openingElement.getTagNameNode().getText();
      const slotAttribute = openingElement
        .getAttributes()
        .find((attribute) => Node.isJsxAttribute(attribute) && attribute.getNameNode().getText() === 'slot');

      if (tagName === 'slot') {
        const nameAttribute = openingElement
          .getAttributes()
          .find((attribute) => Node.isJsxAttribute(attribute) && attribute.getNameNode().getText() === 'name');
        const initializer = Node.isJsxAttribute(nameAttribute) ? nameAttribute.getInitializer() : undefined;
        const name =
          initializer && Node.isStringLiteral(initializer)
            ? initializer.getLiteralValue()
            : initializer && Node.isJsxExpression(initializer)
              ? (initializer.getExpression()?.getText() ?? '')
              : '';
        upsertSlot({ ...parseStencilSlot(name) });
        return;
      }

      if (!Node.isJsxAttribute(slotAttribute)) return;
      const initializer = slotAttribute.getInitializer();
      if (!initializer || !Node.isStringLiteral(initializer)) return;
      const name = initializer.getLiteralValue();
      if (!name) return;
      upsertSlot({ name, isDefault: false });
    });
  }

  return [...slots.values()].sort((a, b) => a.name.localeCompare(b.name));
}
