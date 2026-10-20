import { bucketComponentsProps } from '@contentful/experience-design-system-extraction';
import { stripPropProvenance } from '../../../../agents/prompts/helpers/strip-prop-provenance.js';
import { buildPrompt, createLocalCliAgentInvoker, parseSelectToolCalls } from '../../../../agents/index.js';
import type { RunSelectionServiceOptions, SelectionServiceResult, ComponentSelection } from '../types/contract.js';
import { summarizeForSelect } from '../../../generation/src/controller/existing-entities/summarize-for-select.js';
import { buildCompilerEvidenceInline } from '../../../../agents/prompts/helpers/build-compiler-evidence-inline.js';

const DEFAULT_TIMEOUT_MS = Number(process.env.EDS_AGENT_TIMEOUT_MS ?? 5 * 60 * 1000);

export async function runSelectionService(options: RunSelectionServiceOptions): Promise<SelectionServiceResult> {
  const { components, agent, model } = options;
  if (components.length === 0) return { selections: [], warnings: [] };

  const warnings: string[] = [];
  const invoker = createLocalCliAgentInvoker({});
  let existingComponentsInline = options.existingComponentsInline;
  let existingTokensInline = options.existingTokensInline;
  if (options.existingContentfulEntities) {
    try {
      const summary = summarizeForSelect({ entities: options.existingContentfulEntities });
      existingComponentsInline ??= JSON.stringify(summary.components);
      existingTokensInline ??= JSON.stringify(summary.tokens);
    } catch {
      warnings.push('Optional existing model context could not be summarized');
    }
  }

  const selectBuckets = bucketComponentsProps(components);
  for (const assignment of selectBuckets) {
    options.onDebugEvent?.('prop-buckets.select', { ...assignment });
  }
  const prompt = await buildPrompt({
    skill: 'select',
    mode: 'autonomous',
    rawComponentsInline: JSON.stringify(
      components.map(
        ({
          sourceCandidates: _candidates,
          sourceCandidateSources: _sources,
          componentFacts: _facts,
          ...component
        }) => ({
          ...component,
          props: component.props.map(stripPropProvenance),
        }),
      ),
      null,
      2,
    ),
    compilerEvidenceInline:
      options.compilerEvidenceInline ?? buildCompilerEvidenceInline(components, { readiness: 'caller-provided' }),
    propBucketsInline: JSON.stringify(selectBuckets),
    outDir: process.cwd(),
    existingComponentsInline,
    existingTokensInline,
    ...(options.selectionEvidenceInline !== undefined
      ? { selectionEvidenceInline: options.selectionEvidenceInline }
      : {}),
    ...(options.promptPath ? { skillPathOverride: options.promptPath } : {}),
    ...(options.promptText !== undefined ? { skillContentOverride: options.promptText } : {}),
  });

  const agentRun = await invoker.invoke({ agent, model, prompt, timeoutMs: DEFAULT_TIMEOUT_MS });
  if (agentRun.timedOut) throw new Error('selection agent timed out');
  if (agentRun.exitCode !== 0) throw new Error(`selection agent exited with code ${agentRun.exitCode}`);

  const parsed = parseSelectToolCalls(agentRun.stdout);
  for (const warning of parsed.warnings) warnings.push(`selection agent: ${warning}`);

  const selections: ComponentSelection[] = parsed.calls.map((call) => ({
    name: call.name,
    component_id: call.name,
    decision: call.tool === 'reject_component' ? 'rejected' : 'accepted',
    reason: call.tool === 'reject_component' ? (call.reason ?? null) : null,
  }));

  return { selections, warnings };
}
