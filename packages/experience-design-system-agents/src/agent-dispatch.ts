import type { AgentInvoker, AgentName } from '@contentful/experience-design-system-generation';
import { buildPrompt, parseSelectToolCallLines } from '@contentful/experience-design-system-generation';
import type { RawComponentDefinition } from '@contentful/experience-design-system-extraction';
import { invokeOnce } from './invoke-agent.js';
import type { SelectionResult } from './selection-diff.js';

export interface SelectionAgentDispatcherOptions {
  invoker: AgentInvoker;
  agent: AgentName;
  model?: string;
  timeoutMs: number;
  outDir: string;
  buildPrompt?: (options: Parameters<typeof buildPrompt>[0]) => Promise<string>;
}

export type SelectionAgentDispatcher = (
  component: RawComponentDefinition,
  agentIndex: number,
) => Promise<SelectionResult>;

export function createSelectionAgentDispatcher(options: SelectionAgentDispatcherOptions): SelectionAgentDispatcher {
  const promptBuilder = options.buildPrompt ?? buildPrompt;

  return async (component) => {
    const prompt = await promptBuilder({
      skill: 'select',
      mode: 'autonomous',
      outDir: options.outDir,
      componentName: component.name,
      rawComponentsInline: JSON.stringify([component]),
    });
    const result = await invokeOnce(options, prompt, `Selection agent failed for ${component.name}`);

    const parsed = parseSelectToolCallLines(result.stdout);
    if (parsed.warnings.length > 0) {
      throw new Error(`Selection agent returned invalid evidence for ${component.name}: ${parsed.warnings.join('; ')}`);
    }
    const call = parsed.calls.find(({ name }) => name === component.name);
    if (!call) {
      throw new Error(`Selection agent returned no decision for ${component.name}`);
    }

    const slotEvidence = call.tool === 'select_component' ? call.slot_evidence : undefined;
    return {
      componentKey: `${component.name}::${component.source}`,
      decision: call.tool === 'select_component' ? 'accepted' : 'rejected',
      reason: call.reason ?? 'No reason provided by selection agent.',
      ...(slotEvidence ? { facts: { slotEvidence } } : {}),
    };
  };
}
