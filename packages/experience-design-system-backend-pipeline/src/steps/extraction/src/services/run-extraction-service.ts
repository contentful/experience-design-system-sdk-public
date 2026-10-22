import { extractComponents } from './extraction/extract-components.js';
import type { ExtractComponentsRequest, ExtractComponentsResponse } from '../types/contract.js';

export { extractComponents } from './extraction/extract-components.js';

export async function runExtractionService(request: ExtractComponentsRequest): Promise<ExtractComponentsResponse> {
  return extractComponents(
    request.filePaths,
    request.onProgress
      ? (progress) => request.onProgress?.({ ...progress, phase: 'extract', totalFiles: request.filePaths.length })
      : undefined,
    { ...request.opts, ...(request.projectRoot !== undefined ? { projectRoot: request.projectRoot } : {}) },
  );
}
