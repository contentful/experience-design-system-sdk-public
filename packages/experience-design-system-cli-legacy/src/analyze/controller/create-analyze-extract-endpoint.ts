import { resolve, join } from 'node:path';
import { agentSupportsBedrock } from '@contentful/experience-design-system-generation';
import { resolveCompositionSources } from '../composition/resolve-mapping-cli.js';
import { resolveCompositionAgentName } from '../helpers/resolve-composition-agent.js';
import { resolveSourceDirectory } from '../services/resolve-source-directory.js';
import { parsePromptOverrides, resolvePromptOverride } from '../../lib/prompt-overrides.js';
import {
  executeAnalyzeExtractOrchestrator,
  type AnalyzeExtractOrchestratorResult,
} from '../orchestrator/execute-analyze-extract.js';

export interface AnalyzeExtractEndpointRequest {
  projectPath: string;
  agent?: string;
  noCache: boolean;
  promptOverrides?: string[];
  bedrock?: boolean;
  onScanProgress?: (count: number) => void;
  onCompositionProgress?: (phase: string) => void;
  onSessionCreated?: (sessionId: string) => Promise<void> | void;
}

export type AnalyzeExtractEndpointResponse = AnalyzeExtractOrchestratorResult;

export async function analyzeExtractEndpoint(
  request: AnalyzeExtractEndpointRequest,
): Promise<AnalyzeExtractEndpointResponse> {
  const agent = resolveCompositionAgentName(request.agent);

  if (request.bedrock && !agentSupportsBedrock(agent)) {
    throw new Error(`--bedrock is not supported for --agent ${agent}`);
  }

  const { overrides, errors } = parsePromptOverrides(request.promptOverrides ?? []);
  if (errors.length > 0) throw new Error(errors.join('; '));

  const projectRoot = resolve(request.projectPath);
  const outDir = join(projectRoot, '.contentful');
  const sourceDirectory = await resolveSourceDirectory(projectRoot, undefined);
  const compositionSources = resolveCompositionSources({
    compositionRefresh: request.noCache,
    noCache: request.noCache,
  });

  let compositionPrompt: string | undefined;
  const compositionOverride = overrides.get('composition');
  if (compositionOverride) compositionPrompt = await resolvePromptOverride(compositionOverride);

  return executeAnalyzeExtractOrchestrator({
    projectRoot,
    sourceDirectory,
    outDir,
    noCache: request.noCache,
    forceAgent: compositionSources.forceAgent,
    agent,
    compositionPrompt,
    resolveUnreachable: 'auto',
    onScanProgress: request.onScanProgress,
    onCompositionProgress: request.onCompositionProgress,
    onSessionCreated: request.onSessionCreated,
  });
}
