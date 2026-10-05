import type { ExtractionEndpointRequest, ExtractionEndpointResponse } from '../types/contract.js';
import { runExtractionService } from '../services/run-extraction-service.js';
import { validateRequest } from './helpers/validate-endpoint-request.js';

export type {
  ExtractionEndpointProgress,
  ExtractionEndpointRequest,
  ExtractionEndpointResponse,
} from '../types/contract.js';

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
