export function countMappableProps(
  cdfEntries: Array<{ entry: { $properties?: Record<string, { $type: string; $category?: string }> } }>,
): number {
  return cdfEntries.reduce((count, { entry }) => {
    const props = entry.$properties ?? {};
    return count + Object.values(props).filter((prop) => prop.$type === 'token' && prop.$category === 'design').length;
  }, 0);
}
