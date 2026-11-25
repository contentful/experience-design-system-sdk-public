import type { ComponentExtractionResult, ExtractorProgress } from './component.js';
import type { ExtractorOptions } from './options.js';

export interface ComponentExtractor {
  name: string;
  fileFilter: (filePath: string) => boolean;
  extract(
    filePaths: string[],
    onProgress?: (progress: ExtractorProgress) => void,
    options?: ExtractorOptions,
  ): Promise<ComponentExtractionResult>;
}
