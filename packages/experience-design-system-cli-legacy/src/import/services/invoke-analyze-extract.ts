import { resolve, join } from 'node:path';
import { agentSupportsBedrock } from '@contentful/experience-design-system-generation';
import { resolveCompositionSources } from '../../analyze/composition/resolve-mapping-cli.js';
import { resolveCompositionAgentName } from '../../analyze/helpers/resolve-composition-agent.js';
import { resolveSourceDirectory } from '../../analyze/services/resolve-source-directory.js';
import { parsePromptOverrides, resolvePromptOverride } from '../../lib/prompt-overrides.js';
import {
  executeAnalyzeExtractOrchestrator,
  type AnalyzeExtractOrchestratorResult,
} from '../../analyze/orchestrator/execute-analyze-extract.js';

export interface InvokeAnalyzeExtractOptions {
  projectPath: string;
  agent?: string;
  noCache: boolean;
  promptOverrides?: string[];
  bedrock?: boolean;
  onScanProgress?: (count: number) => void;
  onCompositionProgress?: (phase: string) => void;
  onSessionCreated?: (sessionId: string) => Promise<void> | void;
}

export async function invokeAnalyzeExtract(
  opts: InvokeAnalyzeExtractOptions,
): Promise<AnalyzeExtractOrchestratorResult> {
  const agent = resolveCompositionAgentName(opts.agent);

  if (opts.bedrock && !agentSupportsBedrock(agent)) {
    throw new Error(`--bedrock is not supported for --agent ${agent}`);
  }

  const projectRoot = resolve(opts.projectPath);
  const outDir = join(projectRoot, '.contentful');
  const sourceDirectory = await resolveSourceDirectory(projectRoot, undefined);
  const compositionSources = resolveCompositionSources({
    compositionRefresh: opts.noCache,
    noCache: opts.noCache,
  });

  const { overrides, errors } = parsePromptOverrides(opts.promptOverrides ?? []);
  if (errors.length > 0) throw new Error(errors.join('; '));

  let compositionPrompt: string | undefined;
  const compositionOverride = overrides.get('composition');
  if (compositionOverride) compositionPrompt = await resolvePromptOverride(compositionOverride);

  return executeAnalyzeExtractOrchestrator({
    projectRoot,
    sourceDirectory,
    outDir,
    noCache: opts.noCache,
    forceAgent: compositionSources.forceAgent,
    agent,
    compositionPrompt,
    resolveUnreachable: 'auto',
    onScanProgress: opts.onScanProgress,
    onCompositionProgress: opts.onCompositionProgress,
    onSessionCreated: opts.onSessionCreated,
  });
}
