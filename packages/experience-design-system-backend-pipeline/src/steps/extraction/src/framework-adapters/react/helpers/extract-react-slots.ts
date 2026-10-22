import { type Type, type Symbol as MorphSymbol } from 'ts-morph';
import type { RawSlotDefinition } from '../../../types/component.js';

export function isRenderPropType(type: Type): boolean {
  const callSignatures = type.getCallSignatures();
  if (callSignatures.length === 0) return false;

  const returnType = callSignatures[0].getReturnType();
  const returnText = returnType.getText();
  return /ReactNode|ReactElement|JSX\.Element|Element/.test(returnText);
}

export function getRenderPropType(property: MorphSymbol): Type | undefined {
  if (!property.getName().startsWith('render')) return undefined;

  const declaration = property.getValueDeclaration() ?? property.getDeclarations()[0];
  if (!declaration) return undefined;

  const propType = property.getTypeAtLocation(declaration);
  return isRenderPropType(propType) ? propType : undefined;
}

export function collectRenderPropSlotNames(type: Type): Set<string> {
  const names = new Set<string>();
  for (const property of type.getProperties()) {
    if (getRenderPropType(property)) names.add(property.getName());
  }
  return names;
}

export function extractSlots(type: Type, hasChildren: boolean): RawSlotDefinition[] {
  const slots: RawSlotDefinition[] = [];

  if (hasChildren) {
    slots.push({ name: 'children', isDefault: true });
  }

  for (const property of type.getProperties()) {
    const name = property.getName();
    if (name === 'children') continue;
    if (!getRenderPropType(property)) continue;

    const slotName = name.replace(/^render/, '');
    slots.push({
      name: slotName.charAt(0).toLowerCase() + slotName.slice(1),
      isDefault: false,
    });
  }

  return slots.sort((a, b) => a.name.localeCompare(b.name));
}
