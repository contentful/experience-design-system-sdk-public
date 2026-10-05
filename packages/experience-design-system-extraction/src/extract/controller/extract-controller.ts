import type { ExtractionEndpointRequest, ExtractionEndpointResponse } from '../model/contract.js';
import { runExtractionService } from '../services/extraction-service.js';

export type {
  ExtractionEndpointProgress,
  ExtractionEndpointRequest,
  ExtractionEndpointResponse,
} from '../model/contract.js';

function validateRequest(request: ExtractionEndpointRequest): void {
  if (request === null || typeof request !== 'object') {
    throw new TypeError('extractEndpoint requires a request object');
  }

  if (!Array.isArray(request.filePaths)) {
    throw new TypeError('extractEndpoint requires filePaths to be an array');
  }

  if (request.filePaths.some((filePath) => typeof filePath !== 'string' || filePath.trim().length === 0)) {
    throw new TypeError('extractEndpoint requires filePaths to contain non-empty strings');
  }

  if (
    request.projectRoot !== undefined &&
    (typeof request.projectRoot !== 'string' || request.projectRoot.trim().length === 0)
  ) {
    throw new TypeError('extractEndpoint requires projectRoot to be a non-empty string when provided');
  }

  if (
    request.resolveUnreachable !== undefined &&
    request.resolveUnreachable !== 'auto' &&
    request.resolveUnreachable !== 'always' &&
    request.resolveUnreachable !== 'never'
  ) {
    throw new TypeError("extractEndpoint requires resolveUnreachable to be 'auto', 'always', or 'never'");
  }

  if (request.onProgress !== undefined && typeof request.onProgress !== 'function') {
    throw new TypeError('extractEndpoint requires onProgress to be a function when provided');
  }
}

/**
 * Stable in-process extraction contract.
 *
 * The controller owns public request validation and progress translation. The
 * extraction service owns source analysis and quality policy; neither layer
 * scans directories, invokes agents, or persists sessions.
 */
export async function extractEndpoint(request: ExtractionEndpointRequest): Promise<ExtractionEndpointResponse> {
  validateRequest(request);
  const filePaths = [...request.filePaths];
  const result = await runExtractionService({
    filePaths,
    ...(request.resolveUnreachable !== undefined ? { resolveUnreachable: request.resolveUnreachable } : {}),
    ...(request.projectRoot !== undefined ? { projectRoot: request.projectRoot } : {}),
    onProgress: ({ filesProcessed, componentsFound }) => {
      request.onProgress?.({
        phase: 'extract',
        filesProcessed,
        totalFiles: filePaths.length,
        componentsFound,
      });
    },
  });

  request.onProgress?.({
    phase: 'extract',
    filesProcessed: filePaths.length,
    totalFiles: filePaths.length,
    componentsFound: result.components.length,
  });

  return result;
}
