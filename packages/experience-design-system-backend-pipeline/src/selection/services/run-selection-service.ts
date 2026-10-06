import {
  buildPrompt,
  createLocalCliAgentInvoker,
  isAgentName,
  parseSelectToolCallLines,
} from '@contentful/experience-design-system-generation';
import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import type { SelectionServiceResult, ComponentSelection } from '../types/contract.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);

export interface RunSelectionServiceOptions {
  components: RawComponentDefinition[];
  agent: string;
  model?: string;
  promptText?: string;
  promptPath?: string;
  onCacheLookup?: (componentHash: string, promptHash: string) => { decision: 'accepted' | 'rejected'; reason: string | null } | null;
  onCacheStore?: (componentHash: string, promptHash: string, decision: 'accepted' | 'rejected', reason: string | null) => void;
  onWarning?: (message: string) => void;
}

export async function runSelectionService(options: RunSelectionServiceOptions): Promise<SelectionServiceResult> {
  const { components, agent, model } = options;
  if (components.length === 0) return { selections: [], warnings: [] };

  if (!isAgentName(agent)) throw new Error(`Unknown agent: "${agent}"`);

  const warnings: string[] = [];
  const invoker = createLocalCliAgentInvoker({});

  const prompt = await buildPrompt({
    skill: 'select',
    mode: 'autonomous',
    rawComponentsInline: JSON.stringify(components, null, 2),
    outDir: process.cwd(),
    ...(options.promptText !== undefined ? { skillContentOverride: options.promptText } : {}),
    ...(options.promptText === undefined && options.promptPath ? { skillPathOverride: options.promptPath } : {}),
  });

  const result = await invoker.invoke({ agent, model, prompt, timeoutMs: DEFAULT_TIMEOUT_MS });
  if (result.timedOut) throw new Error('selection agent timed out');
  if (result.exitCode !== 0) throw new Error(`selection agent exited with code ${result.exitCode}`);

  const parsed = parseSelectToolCallLines(result.stdout);
  for (const warning of parsed.warnings) warnings.push(`selection agent: ${warning}`);

  const selections: ComponentSelection[] = parsed.calls.map((call) => ({
    name: call.name,
    component_id: call.name,
    decision: call.tool === 'reject_component' ? 'rejected' : 'accepted',
    reason: call.tool === 'reject_component' ? (call.reason ?? null) : null,
  }));

  return { selections, warnings };
}
