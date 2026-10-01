import type { ComponentExtractionResult, ExtractorProgress } from '../model/component.js';
import type { ExtractorOptions } from '../model/options.js';
import type { ComponentExtractor } from './ports/component-extractor.js';
import type { ExtractorFileGroup } from './extractor-registry.js';

export async function runExtractorBatches(
  batches: readonly ExtractorFileGroup[],
  onProgress?: (progress: ExtractorProgress) => void,
  options?: ExtractorOptions,
): Promise<ComponentExtractionResult[]> {
  const perExtractorFiles = new Map<ComponentExtractor, number>();
  const perExtractorComponents = new Map<ComponentExtractor, number>();
  let totalFilesProcessed = 0;
  let totalComponentsFound = 0;

  return Promise.all(
    batches.map(async ({ extractor, filePaths }) => {
      if (filePaths.length === 0) return { components: [], warnings: [] };

      perExtractorFiles.set(extractor, 0);
      perExtractorComponents.set(extractor, 0);
      return extractor.extract(
        filePaths,
        (progress) => {
          const previousFiles = perExtractorFiles.get(extractor) ?? 0;
          const previousComponents = perExtractorComponents.get(extractor) ?? 0;
          totalFilesProcessed += progress.filesProcessed - previousFiles;
          totalComponentsFound += progress.componentsFound - previousComponents;
          perExtractorFiles.set(extractor, progress.filesProcessed);
          perExtractorComponents.set(extractor, progress.componentsFound);
          onProgress?.({ filesProcessed: totalFilesProcessed, componentsFound: totalComponentsFound });
        },
        options,
      );
    }),
  );
}
