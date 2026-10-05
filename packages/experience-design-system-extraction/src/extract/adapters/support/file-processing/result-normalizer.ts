export function createSortedExtractionResult<T extends { name: string }>(
  components: T[],
  warnings: string[],
): { components: T[]; warnings: string[] } {
  return {
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    warnings,
  };
}
