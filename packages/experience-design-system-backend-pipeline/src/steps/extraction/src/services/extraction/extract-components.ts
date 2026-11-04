import type { ComponentExtractionResult, ExtractorProgress } from '../../types/component.js';
import type { ExtractorOptions } from '../../types/options.js';
import { deduplicateComponents } from '../deduplication/deduplicate-components.js';
import { extractorRegistry, routeFilesToExtractors } from './helpers/register-extractors.js';
import { runExtractorBatches } from './helpers/run-extractor-batches.js';
import { collectSvelteKitRouteExclusions } from './helpers/collect-sveltekit-route-exclusions.js';
import { mergeExtractionDiagnostics } from '../../compiler/diagnostics.js';
import { aggregateExtractionSourceInventory } from '../../../source-evidence/extraction-inventory.js';

export async function extractComponents(
  filePaths: string[],
  onProgress?: (progress: ExtractorProgress) => void,
  opts?: ExtractorOptions,
): Promise<ComponentExtractionResult> {
  const routeExclusions = collectSvelteKitRouteExclusions(filePaths);
  const routedFiles = routeFilesToExtractors(filePaths, extractorRegistry);
  const results = await runExtractorBatches(routedFiles, onProgress, opts);
  const deduplicated = deduplicateComponents(results);
  const allExclusions = [...routeExclusions, ...(deduplicated.exclusions ?? [])];
  const extractionDiagnostics = mergeExtractionDiagnostics(results.map((result) => result.extractionDiagnostics));
  return {
    components: deduplicated.components,
    warnings: deduplicated.warnings,
    ...(allExclusions.length > 0 ? { exclusions: allExclusions } : {}),
    ...(extractionDiagnostics ? { extractionDiagnostics } : {}),
    compilerSources: results.flatMap((result) => result.compilerSources ?? []),
    sourceInventory: aggregateExtractionSourceInventory(filePaths, results, opts),
  };
}
