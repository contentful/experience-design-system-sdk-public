import type { AgentName } from '@contentful/experience-design-system-generation';
import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import { resolveCompositionService } from '../services/resolve-composition-service.js';

export interface CompositionOrchestratorRequest {
  components: RawComponentDefinition[];
  allFiles: Array<{ path: string; content: string }>;
  forceAgent: boolean;
  agent: AgentName;
  promptOverride?: string;
  onProgress?: (phase: string) => void;
  onCacheLookup?: (cacheKey: string) => string | null;
  onCacheStore?: (cacheKey: string, stdout: string) => void;
  onWarning?: (message: string) => void;
}

export interface CompositionOrchestratorResult {
  components: RawComponentDefinition[];
  warnings: string[];
}

export async function executeCompositionOrchestrator(
  request: CompositionOrchestratorRequest,
): Promise<CompositionOrchestratorResult> {
  return resolveCompositionService(request);
}
