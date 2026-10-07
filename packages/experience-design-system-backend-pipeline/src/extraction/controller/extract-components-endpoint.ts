import { extractEndpoint } from '@contentful/experience-design-system-extraction';
import type { ExtractComponentsRequest, ExtractComponentsResponse } from '../types/contract.js';

export type { ExtractComponentsRequest, ExtractComponentsResponse };

export async function extractComponents(
  request: ExtractComponentsRequest,
): Promise<ExtractComponentsResponse> {
  return extractEndpoint(request);
}
