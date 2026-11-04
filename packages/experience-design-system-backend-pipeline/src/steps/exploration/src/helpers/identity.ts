import type { KnownComponent } from '@contentful/experience-design-system-types';
export type { KnownComponent };
export function canonicalComponentSource(
  known?: readonly KnownComponent[],
): (name: string, source: string) => string | null {
  return (name, source) =>
    !known || known.some((component) => component.name === name && component.source === source) ? source : null;
}
export function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`);
}
