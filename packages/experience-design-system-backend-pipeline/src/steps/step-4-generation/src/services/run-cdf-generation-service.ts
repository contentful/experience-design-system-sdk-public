import { createHash } from 'node:crypto';
import {
  buildPrompt,
  createLocalCliAgentInvoker,
  parseToolCallLines,
  type ToolCall,
} from '../../../shared/src/agent/index.js';
import type { RawComponentDefinition } from '../../../step-1-extraction/src/extraction-types.js';
import type {
  CDFComponentEntry,
  CDFPropertyDefinition,
  CDFSlotDefinition,
} from '../../../shared/src/cdf-types/index.js';
import type {
  CdfGenerationFailure,
  RunCdfGenerationServiceOptions,
  RunCdfGenerationServiceResult,
} from '../types/contract.js';

const DEFAULT_CONCURRENCY = 3;
const AGENT_TIMEOUT_MS = 120_000;

function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function toolCallsToEntry(component: RawComponentDefinition, calls: ToolCall[]): CDFComponentEntry {
  const properties: Record<string, CDFPropertyDefinition> = {};
  const slots: Record<string, CDFSlotDefinition> = {};
  let description: string | undefined;

  const knownProps = new Set(component.props.map((p) => p.name));
  const knownSlots = new Set(component.slots.map((s) => s.name));

  for (const call of calls) {
    if (call.tool === 'classify_component') {
      if (call.description) description = call.description;
    } else if (call.tool === 'classify_prop') {
      if (!knownProps.has(call.prop)) continue;
      const prop: CDFPropertyDefinition = {
        $type: call.cdf_type as CDFPropertyDefinition['$type'],
        $category: call.cdf_category,
      };
      if (call.description) prop.$description = call.description;
      if (call.required !== undefined) prop.$required = call.required;
      if (call.default !== undefined) prop.$default = call.default;
      if (call.cdf_type === 'token') {
        if (call.token_kind) prop['$token.kind'] = call.token_kind;
      } else if (call.values && call.values.length > 0) {
        prop.$values = call.values;
      }
      properties[call.prop] = prop;
    } else if (call.tool === 'classify_slot') {
      if (!knownSlots.has(call.slot)) continue;
      const slot: CDFSlotDefinition = {};
      if (call.description) slot.$description = call.description;
      if (call.required !== undefined) slot.$required = call.required;
      if (call.allowed_components && call.allowed_components.length > 0)
        slot.$allowedComponents = call.allowed_components;
      slots[call.slot] = slot;
    }
  }

  const entry: CDFComponentEntry = { $type: 'component', $properties: properties };
  if (description) entry.$description = description;
  if (Object.keys(slots).length > 0) entry.$slots = slots;
  return entry;
}

async function generateOne(
  component: RawComponentDefinition,
  options: RunCdfGenerationServiceOptions,
  index: number,
  total: number,
): Promise<{ entry?: CDFComponentEntry; failure?: CdfGenerationFailure; warnings: string[] }> {
  const { agent, model, skillPathOverride, skillContentOverride, onCacheLookup, onCacheStore, onProgress, onWarning } =
    options;

  onProgress?.(component.name, index, total);

  const inputHash = hashString(JSON.stringify(component));

  const prompt = await buildPrompt({
    skill: 'components',
    mode: 'autonomous',
    rawComponentsInline: JSON.stringify(component),
    outDir: '',
    componentName: component.name,
    skillPathOverride,
    skillContentOverride,
  });

  const promptHash = hashString(prompt);

  const cached = onCacheLookup?.(inputHash, promptHash);
  if (cached) return { entry: cached, warnings: [] };

  const invoker = createLocalCliAgentInvoker();
  let agentResult;
  try {
    agentResult = await invoker.invoke({ agent, model, prompt, timeoutMs: AGENT_TIMEOUT_MS });
  } catch (error) {
    return {
      failure: { componentName: component.name, error: error instanceof Error ? error.message : String(error) },
      warnings: [],
    };
  }

  if (agentResult.timedOut || agentResult.exitCode !== 0) {
    const error = agentResult.timedOut
      ? 'agent timed out'
      : `agent exited with code ${agentResult.exitCode}: ${agentResult.stderr.slice(0, 500)}`;
    return { failure: { componentName: component.name, error }, warnings: [] };
  }

  const { calls, warnings } = parseToolCallLines(agentResult.stdout);
  for (const w of warnings) onWarning?.(`${component.name}: ${w}`);

  const entry = toolCallsToEntry(component, calls);
  onCacheStore?.(inputHash, promptHash, entry);

  return { entry, warnings };
}

export async function runCdfGenerationService(
  options: RunCdfGenerationServiceOptions,
): Promise<RunCdfGenerationServiceResult> {
  const { components, concurrency = DEFAULT_CONCURRENCY } = options;

  const resultComponents: CDFComponentEntry[] = [];
  const allWarnings: string[] = [];
  const failures: CdfGenerationFailure[] = [];
  const total = components.length;

  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < total) {
      const i = cursor++;
      const component = components[i]!;
      const result = await generateOne(component, options, i, total);
      if (result.failure) {
        failures.push(result.failure);
      } else if (result.entry) {
        resultComponents.push(result.entry);
      }
      allWarnings.push(...result.warnings);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));

  return { components: resultComponents, warnings: allWarnings, failures };
}
