import { Node, type ClassDeclaration } from 'ts-morph';
import type { RawSlotDefinition } from '../../../../types/component.js';

export function extractContentChildQueries(cls: ClassDeclaration): RawSlotDefinition[] {
  const out: RawSlotDefinition[] = [];

  for (const field of cls.getProperties()) {
    const fieldName = field.getName();

    const init = field.getInitializer();
    if (init && Node.isCallExpression(init)) {
      const callee = init.getExpression();
      if (Node.isIdentifier(callee)) {
        const name = callee.getText();
        if (name === 'contentChild' || name === 'contentChildren') {
          const first = init.getArguments()[0];
          const allowed = resolveClassIdentifierArg(first);
          out.push(buildSlot(fieldName, allowed));
          continue;
        }
      }
    }

    for (const decName of ['ContentChild', 'ContentChildren']) {
      const dec = field.getDecorator(decName);
      if (dec) {
        const first = dec.getArguments()[0];
        const allowed = resolveClassIdentifierArg(first);
        out.push(buildSlot(fieldName, allowed));
        break;
      }
    }
  }

  return out;
}

function resolveClassIdentifierArg(arg: Node | undefined): string[] {
  if (!arg) return [];

  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) return [];
  if (Node.isIdentifier(arg)) return [arg.getText()];
  return [];
}

function buildSlot(name: string, allowed: string[]): RawSlotDefinition {
  const slot: RawSlotDefinition = {
    name,
    isDefault: false,
  };
  if (allowed.length > 0) slot.allowedComponents = allowed;
  return slot;
}
