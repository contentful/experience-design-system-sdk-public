import { runApplyService } from '../../services/run-apply-service.js';
import type { ApplyEndpointRequest, ApplyEndpointResponse } from '../../types/contract.js';

export type { ApplyEndpointRequest, ApplyEndpointResponse };

export async function applyComponents(request: ApplyEndpointRequest): Promise<ApplyEndpointResponse> {
  if (!request.credentials.accessToken) {
    throw new Error('credentials.accessToken is required');
  }
  if (!request.credentials.spaceId) {
    throw new Error('credentials.spaceId is required');
  }
  if (!request.credentials.environmentId) {
    throw new Error('credentials.environmentId is required');
  }

  return runApplyService(request);
}
