import { runExtractionService } from '../services/run-extraction-service.js';
import type { ExtractComponentsRequest, ExtractComponentsResponse } from '../types/contract.js';

export type { ExtractComponentsRequest, ExtractComponentsResponse };

export async function extractComponents(request: ExtractComponentsRequest): Promise<ExtractComponentsResponse> {
  if (request.filePaths.some((f) => !f.trim())) {
    throw new Error('extractEndpoint requires filePaths to contain non-empty strings');
  }
  return runExtractionService(request);
}
