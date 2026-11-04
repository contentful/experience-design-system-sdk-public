import { runCompositionService } from '../../services/run-composition-service.js';
import type { ComposeComponentsRequest, ComposeComponentsResponse } from '../../types/contract.js';

export type { ComposeComponentsRequest, ComposeComponentsResponse };

export async function composeComponents(request: ComposeComponentsRequest): Promise<ComposeComponentsResponse> {
  return runCompositionService(request);
}
