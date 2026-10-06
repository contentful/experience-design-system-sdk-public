import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import { runSelectionService } from '../services/run-selection-service.js';
import type { SelectionServiceResult, ComponentSelection } from '../types/contract.js';

export interface SelectionOrchestratorRequest {
  components: RawComponentDefinition[];
  agent: string;
  model?: string;
  promptText?: string;
  promptPath?: string;
  onCacheLookup?: (componentHash: string, promptHash: string) => { decision: 'accepted' | 'rejected'; reason: string | null } | null;
  onCacheStore?: (componentHash: string, promptHash: string, decision: 'accepted' | 'rejected', reason: string | null) => void;
  onWarning?: (message: string) => void;
}

export type SelectionOrchestratorResult = SelectionServiceResult;

export { type ComponentSelection };

export async function executeSelectionOrchestrator(
  request: SelectionOrchestratorRequest,
): Promise<SelectionOrchestratorResult> {
  return runSelectionService(request);
}
