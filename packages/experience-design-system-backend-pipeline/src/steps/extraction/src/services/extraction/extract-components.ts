import { profileImportSync } from '../../../../../profiling/import-profile.js';
import type { ComponentExtractionResult, ExtractionExclusion, ExtractorProgress } from '../../types/component.js';
import type { ExtractorOptions } from '../../types/options.js';
import { deduplicateComponents } from '../deduplication/deduplicate-components.js';
import { extractorRegistry, routeFilesToExtractors } from './helpers/register-extractors.js';
import { runExtractorBatches } from './helpers/run-extractor-batches.js';
import { collectSvelteKitRouteExclusions } from './helpers/collect-sveltekit-route-exclusions.js';
import { mergeExtractionDiagnostics } from '../../compiler/diagnostics.js';

function excludeHookComponents(result: ComponentExtractionResult): ComponentExtractionResult {
  const warnings = [...result.warnings];
  const exclusions: ExtractionExclusion[] = [];
  const components = result.components.filter((component) => {
    if (!/^use[A-Z]/.test(component.name)) return true;
    warnings.push(`Skipped hook: ${component.name} (hooks are not renderable components)`);
    exclusions.push({
      itemType: 'component',
      name: component.name,
      source: component.source,
      reason: 'Hook names are not renderable components',
      stage: 'component-filter',
    });
    return false;
  });
  return { ...result, components, warnings, exclusions: [...(result.exclusions ?? []), ...exclusions] };
}

export async function extractComponents(
  filePaths: string[],
  onProgress?: (progress: ExtractorProgress) => void,
  opts?: ExtractorOptions,
): Promise<ComponentExtractionResult> {
  const routeExclusions = profileImportSync('extraction.routes', () => collectSvelteKitRouteExclusions(filePaths));
  const routedFiles = profileImportSync('extraction.framework-routing', () =>
    routeFilesToExtractors(filePaths, extractorRegistry),
  );
  const results = await runExtractorBatches(routedFiles, onProgress, opts);
  const deduplicated = profileImportSync('extraction.deduplicate', () =>
    excludeHookComponents(deduplicateComponents(results)),
  );
  const allExclusions = [...routeExclusions, ...(deduplicated.exclusions ?? [])];
  const extractionDiagnostics = profileImportSync('extraction.merge-diagnostics', () =>
    mergeExtractionDiagnostics(results.map((result) => result.extractionDiagnostics)),
  );
  return {
    components: deduplicated.components,
    warnings: deduplicated.warnings,
    ...(allExclusions.length > 0 ? { exclusions: allExclusions } : {}),
    ...(extractionDiagnostics ? { extractionDiagnostics } : {}),
    compilerSources: results.flatMap((result) => result.compilerSources ?? []),
  };
}
