import { runSelectionService } from '../services/run-selection-service.js';
import type {
  SelectionOrchestratorRequest,
  SelectionOrchestratorResult,
} from '../types/contract.js';

export type { SelectionOrchestratorRequest, SelectionOrchestratorResult };

export async function executeSelectionOrchestrator(
  request: SelectionOrchestratorRequest,
): Promise<SelectionOrchestratorResult> {
  return runSelectionService(request);
}
