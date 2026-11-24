import type { ExtractionExclusion } from '../../../types/component.js';

export function collectSvelteKitRouteExclusions(filePaths: string[]): ExtractionExclusion[] {
  return filePaths.flatMap((filePath) => {
    if (!filePath.endsWith('.svelte')) return [];
    const name = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
    if (!/^\+(page|layout|error)\.svelte$/.test(name)) return [];
    return [
      {
        itemType: 'file' as const,
        name,
        source: filePath,
        reason: 'SvelteKit route entrypoints are framework-managed, not authorable components',
        stage: 'file-filter',
      },
    ];
  });
}
