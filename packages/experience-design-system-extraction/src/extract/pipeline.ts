import type { ComponentExtractionResult, ExtractorProgress } from './model/component.js';
import type { ExtractorOptions } from './model/options.js';
import { deduplicateComponents } from './services/component-deduplicator.js';
import { extractorRegistry, routeFilesToExtractors } from './services/extractor-registry.js';
import { runExtractorBatches } from './services/extraction-runner.js';

export async function extractComponents(
  filePaths: string[],
  onProgress?: (progress: ExtractorProgress) => void,
  opts?: ExtractorOptions,
): Promise<ComponentExtractionResult> {
  const routedFiles = routeFilesToExtractors(filePaths, extractorRegistry);
  const results = await runExtractorBatches(routedFiles, onProgress, opts);
  const deduplicated = deduplicateComponents(results);
  const components = deduplicated.components.filter((component) => {
    if (!/^use[A-Z]/.test(component.name)) return true;
    deduplicated.warnings.push(`Skipped hook: ${component.name} (hooks are not renderable components)`);
    return false;
  });

  return {
    components,
    warnings: deduplicated.warnings,
  };
}
