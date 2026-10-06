import { resolveCompositionService } from '../services/resolve-composition-service.js';
import type {
  CompositionOrchestratorRequest,
  CompositionOrchestratorResult,
} from '../types/contract.js';

export type { CompositionOrchestratorRequest, CompositionOrchestratorResult };

export async function executeCompositionOrchestrator(
  request: CompositionOrchestratorRequest,
): Promise<CompositionOrchestratorResult> {
  return resolveCompositionService(request);
}
