import {
  buildPrompt,
  createLocalCliAgentInvoker,
  parseSelectToolCallLines,
} from '@contentful/experience-design-system-generation';
import type { RunSelectionServiceOptions, SelectionServiceResult, ComponentSelection } from '../types/contract.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);

export async function runSelectionService(options: RunSelectionServiceOptions): Promise<SelectionServiceResult> {
  const { components, agent, model } = options;
  if (components.length === 0) return { selections: [], warnings: [] };

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

  const agentRun = await invoker.invoke({ agent, model, prompt, timeoutMs: DEFAULT_TIMEOUT_MS });
  if (agentRun.timedOut) throw new Error('selection agent timed out');
  if (agentRun.exitCode !== 0) throw new Error(`selection agent exited with code ${agentRun.exitCode}`);

  const parsed = parseSelectToolCallLines(agentRun.stdout);
  for (const warning of parsed.warnings) warnings.push(`selection agent: ${warning}`);

  const selections: ComponentSelection[] = parsed.calls.map((call) => ({
    name: call.name,
    component_id: call.name,
    decision: call.tool === 'reject_component' ? 'rejected' : 'accepted',
    reason: call.tool === 'reject_component' ? (call.reason ?? null) : null,
  }));

  return { selections, warnings };
}
