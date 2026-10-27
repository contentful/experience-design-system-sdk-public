import * as z from 'zod/mini';

const name = z.string().check(z.refine((value) => value.trim().length > 0));
export const SourceInputAssociationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    componentId: name,
    componentDeclarationId: name,
    rootSymbolId: name,
    inputName: name,
    inputPath: z.array(name).check(z.minLength(1)),
  })
  .check(z.refine((value) => value.inputPath[0] === value.inputName));
export type SourceInputAssociation = z.infer<typeof SourceInputAssociationSchema>;
export function sourceInputOwnerKey(input: SourceInputAssociation): string {
  return JSON.stringify([input.componentId, input.componentDeclarationId, input.rootSymbolId, input.inputPath]);
}
export function validateSourceInputOwners(
  owners: readonly { name: string; sourceInput?: SourceInputAssociation }[],
): void {
  const names = new Set<string>();
  const inputs = new Set<string>();
  for (const owner of owners) {
    if (!owner.name.trim() || names.has(owner.name)) throw new Error('Blank or duplicate authoring name');
    names.add(owner.name);
    if (!owner.sourceInput) continue;
    if (
      !SourceInputAssociationSchema.safeParse(owner.sourceInput).success ||
      owner.sourceInput.inputPath[0] !== owner.sourceInput.inputName
    )
      throw new Error('Invalid source input association');
    const key = sourceInputOwnerKey(owner.sourceInput);
    if (inputs.has(key)) throw new Error('Source input has multiple owners');
    inputs.add(key);
  }
}
export function validateCDFSourceOwnerContract(entry: {
  $properties: Record<string, { $sourceInput?: SourceInputAssociation }>;
  $slots?: Record<string, { $sourceInput?: SourceInputAssociation }>;
}): void {
  validateSourceInputOwners([
    ...Object.entries(entry.$properties).map(([name, property]) => ({
      name: `property:${name}`,
      sourceInput: property.$sourceInput,
    })),
    ...Object.entries(entry.$slots ?? {}).map(([name, slot]) => ({
      name: `slot:${name}`,
      sourceInput: slot.$sourceInput,
    })),
  ]);
  for (const [name, slot] of Object.entries(entry.$slots ?? {})) {
    if (!name.trim()) throw new Error('Blank slot name');
    const input = slot.$sourceInput;
    if (input && entry.$properties[input.inputName] && !entry.$properties[input.inputName]!.$sourceInput)
      throw new Error('Property and slot conflict over source input ownership');
  }
}
