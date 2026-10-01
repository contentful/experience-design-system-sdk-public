import type { RawComponentDefinition } from './component.js';
import type { ExtractorOptions } from './options.js';

export type ExtractionEndpointProgress = {
  phase: 'extract';
  filesProcessed: number;
  totalFiles: number;
  componentsFound: number;
};

export interface ExtractionEndpointRequest extends ExtractorOptions {
  readonly filePaths: readonly string[];
  onProgress?: (progress: ExtractionEndpointProgress) => void;
}

export interface ExtractionEndpointResponse {
  components: RawComponentDefinition[];
  warnings: string[];
}
