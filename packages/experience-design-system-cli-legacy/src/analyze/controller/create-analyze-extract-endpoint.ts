import { resolve, join } from 'node:path';
import { resolveSourceDirectory } from '../services/resolve-source-directory.js';
import {
  executeAnalyzeExtractOrchestrator,
  type AnalyzeExtractOrchestratorResult,
} from '../orchestrator/execute-analyze-extract.js';

export interface AnalyzeExtractEndpointRequest {
  projectPath: string;
  noCache: boolean;
  onScanProgress?: (count: number) => void;
  onCompositionProgress?: (phase: string) => void;
  onSessionCreated?: (sessionId: string) => Promise<void> | void;
}

export type AnalyzeExtractEndpointResponse = AnalyzeExtractOrchestratorResult;

export async function analyzeExtractEndpoint(
  request: AnalyzeExtractEndpointRequest,
): Promise<AnalyzeExtractEndpointResponse> {
  const projectRoot = resolve(request.projectPath);
  const outDir = join(projectRoot, '.contentful');
  const sourceDirectory = await resolveSourceDirectory(projectRoot, undefined);

  return executeAnalyzeExtractOrchestrator({
    projectRoot,
    sourceDirectory,
    outDir,
    noCache: request.noCache,
    resolveUnreachable: 'auto',
    onScanProgress: request.onScanProgress,
    onCompositionProgress: request.onCompositionProgress,
    onSessionCreated: request.onSessionCreated,
  });
}
