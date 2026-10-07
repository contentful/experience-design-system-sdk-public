import type { ComponentExtractionResult, ExtractorOptions } from './component.js';

export interface ExtractionEndpointProgress {
  phase: 'extract';
  filesProcessed: number;
  componentsFound: number;
}

export interface ExtractComponentsRequest {
  filePaths: string[];
  projectRoot?: string;
  opts?: ExtractorOptions;
  onProgress?: (progress: ExtractionEndpointProgress) => void;
}

export type ExtractComponentsResponse = ComponentExtractionResult;
