/** 80 `export const` filler statements, for building a fixture file read as real module source. */
export function exportedFiller(prefix: string): string {
  return Array.from({ length: 80 }, (_, i) => `export const ${prefix}${i} = ${i};`).join('\n');
}
