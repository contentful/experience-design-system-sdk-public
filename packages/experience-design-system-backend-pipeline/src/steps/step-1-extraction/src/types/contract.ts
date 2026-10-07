import type { ComponentExtractionResult, ExtractorOptions } from '@contentful/experience-design-system-extraction';

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
