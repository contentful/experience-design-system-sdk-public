import type { ComponentExtractionResult, ExtractionExclusion, ExtractorProgress } from '../../types/component.js';
import type { ExtractorOptions } from '../../types/options.js';
import { deduplicateComponents } from '../deduplication/deduplicate-components.js';
import { extractorRegistry, routeFilesToExtractors } from './helpers/register-extractors.js';
import { runExtractorBatches } from './helpers/run-extractor-batches.js';

export async function extractComponents(
  filePaths: string[],
  onProgress?: (progress: ExtractorProgress) => void,
  opts?: ExtractorOptions,
): Promise<ComponentExtractionResult> {
  const exclusions: ExtractionExclusion[] = filePaths.flatMap((filePath) => {
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
  const routedFiles = routeFilesToExtractors(filePaths, extractorRegistry);
  const results = await runExtractorBatches(routedFiles, onProgress, opts);
  const deduplicated = deduplicateComponents(results);
  const components = deduplicated.components.filter((component) => {
    if (!/^use[A-Z]/.test(component.name)) return true;
    deduplicated.warnings.push(`Skipped hook: ${component.name} (hooks are not renderable components)`);
    exclusions.push({
      itemType: 'component',
      name: component.name,
      source: component.source,
      reason: 'Hook names are not renderable components',
      stage: 'component-filter',
    });
    return false;
  });

  const allExclusions = [...exclusions, ...(deduplicated.exclusions ?? [])];
  return {
    components,
    warnings: deduplicated.warnings,
    ...(allExclusions.length > 0 ? { exclusions: allExclusions } : {}),
  };
}
