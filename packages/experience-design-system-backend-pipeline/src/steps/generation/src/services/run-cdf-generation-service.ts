import { generateCompleteDecisions } from './property/complete-decisions.js';
import { componentDecisionInventory } from './property/decision-inventory.js';
import { materializeProperty, PropertyAdmissionError } from './property/materialize-property.js';
import { exploreModelDecisions } from './property/explore-model-decisions.js';
import { bucketComponentProps } from '../../../extraction/index.js';
import { stripPropProvenance } from '../../../../agents/prompts/helpers/strip-prop-provenance.js';
import { createHash } from 'node:crypto';
import { createLocalCliAgentInvoker, type ToolCall } from '../../../../agents/index.js';
import { buildGenerationPrompt } from './property/build-generation-prompt.js';
import type { RawComponentDefinition } from '../../../extraction/src/types/component.js';
import type { CDFComponentEntry, CDFPropertyDefinition, CDFSlotDefinition } from '../../../shared/index.js';
import type {
  CdfGenerationFailure,
  RunCdfGenerationServiceOptions,
  RunCdfGenerationServiceResult,
} from '../types/contract.js';
import { throwIfAborted } from '../../../../helpers/abort.js';
import { buildCompilerEvidenceInline } from '../../../../agents/prompts/helpers/build-compiler-evidence-inline.js';
import { attachComponentModelPlan, type RepresentationPlan } from '@contentful/experience-design-system-types';
import {
  projectAcceptedSlots,
  projectAcceptedRawSlots,
} from '../../../exploration/src/services/project-accepted-slots.js';

const DEFAULT_CONCURRENCY = 3;
const AGENT_TIMEOUT_MS = 120_000;

function hashString(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function toolCallsToEntry(
  component: RawComponentDefinition,
  calls: ToolCall[],
  exploredPlans: ReadonlyMap<string, RepresentationPlan>,
): CDFComponentEntry {
  const properties: Record<string, CDFPropertyDefinition> = Object.create(null);
  const slots: Record<string, CDFSlotDefinition> = Object.create(null);
  let description: string | undefined;
  const modelPlans: RepresentationPlan[] = [];

  const knownProps = new Set(componentDecisionInventory(component).properties);
  const knownSlots = new Set(component.slots.map((s) => s.name));

  for (const call of calls) {
    if (call.tool === 'classify_component') {
      if (call.description) description = call.description;
    } else if (call.tool === 'classify_prop') {
      if (!knownProps.has(call.prop)) continue;
      const materialized = materializeProperty(component, call);
      if (materialized.selectedRepresentationPlan) {
        const plan = exploredPlans.get(call.prop);
        if (!plan) throw new Error(`Generated model exploration missing for ${call.prop}`);
        modelPlans.push(plan);
        continue;
      }
      if (
        !materialized.definition ||
        (materialized.projection && !['supported', 'lossy'].includes(materialized.projection.outcome))
      )
        throw new PropertyAdmissionError(materialized);
      const prop = materialized.definition;
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
  return modelPlans.reduce(attachComponentModelPlan, entry);
}

async function generateOne(
  component: RawComponentDefinition,
  options: RunCdfGenerationServiceOptions,
  index: number,
  total: number,
): Promise<{ entry?: CDFComponentEntry; failure?: CdfGenerationFailure; warnings: string[] }> {
  throwIfAborted(options.signal);
  const { agent, model, skillPathOverride, skillContentOverride, onCacheStore, onProgress, onWarning } = options;

  onProgress?.(component.name, index, total);

  const inputHash = hashString(JSON.stringify(component));

  const componentBuckets = bucketComponentProps(component);
  const generationPrompt = await buildGenerationPrompt(
    {
      skill: 'components',
      mode: 'autonomous',
      rawComponentsInline: JSON.stringify(
        (({ sourceCandidates: _candidates, sourceCandidateSources: _sources, componentFacts: _facts, ...raw }) => ({
          ...raw,
          props: component.props.map(stripPropProvenance),
        }))(component),
      ),
      compilerEvidenceInline:
        options.compilerEvidenceInline ?? buildCompilerEvidenceInline([component], { readiness: 'caller-provided' }),
      propBucketsInline: JSON.stringify(componentBuckets),
      outDir: '',
      componentName: component.name,
      skillPathOverride,
      skillContentOverride,
      explorationJudgmentsInline: options.explorationJudgmentsInline,
      sharedSource: options.sharedSource,
      componentSourceRefs: options.componentSourceRefs,
    },
    component,
  );
  throwIfAborted(options.signal);

  const promptHash = hashString(generationPrompt.originalPrompt);

  options.onDebugEvent?.('prop-buckets.generate', { ...componentBuckets });
  const invoker = createLocalCliAgentInvoker();
  const completed = await generateCompleteDecisions({
    ...generationPrompt,
    inventory: componentDecisionInventory(component, options.acceptedSlots),
    timeoutMs: AGENT_TIMEOUT_MS,
    signal: options.signal,
    representationValidation: { component },
    onAttempt: (metrics) => options.onDebugEvent?.('generation.attempt', { ...metrics }),
    invoke: ({ prompt: attemptPrompt, timeoutMs, signal }) =>
      invoker.invoke({ agent, model, prompt: attemptPrompt, timeoutMs, signal }),
  });
  throwIfAborted(options.signal);
  const calls = completed.calls;
  const warnings = completed.diagnostics;
  for (const warning of warnings) {
    throwIfAborted(options.signal);
    onWarning?.(`${component.name}: ${warning}`);
  }
  if (!completed.complete || !completed.representationsComplete)
    return { failure: { componentName: component.name, error: warnings.join('; ') }, warnings };

  throwIfAborted(options.signal);
  let materialized: CDFComponentEntry;
  try {
    const exploredPlans = await exploreModelDecisions(component, calls, {
      invoker,
      agent,
      model,
      outDir: '',
      timeoutMs: AGENT_TIMEOUT_MS,
      operationTimeoutMs: AGENT_TIMEOUT_MS,
      signal: options.signal,
      reservedNames: new Set(options.components.map((candidate) => candidate.name)),
      explorationJudgmentsInline: options.explorationJudgmentsInline,
      sharedSource: options.sharedSource,
      sourceRefs: options.componentSourceRefs,
      onModelStart: (modelKey) => options.onModelExploration?.(component.name, modelKey),
    });
    materialized = toolCallsToEntry(component, calls, exploredPlans);
  } catch (error) {
    throwIfAborted(options.signal);
    return {
      failure: {
        componentName: component.name,
        error: error instanceof Error ? error.message : String(error),
        ...(error instanceof PropertyAdmissionError ? { propertyOutcomes: [error.property] } : {}),
      },
      warnings,
    };
  }
  const entry = projectAcceptedSlots(
    materialized,
    options.acceptedSlots?.filter(
      (decision) => decision.name === component.name && decision.source === component.source,
    ),
  );
  onCacheStore?.(inputHash, promptHash, entry);
  throwIfAborted(options.signal);

  return { entry, warnings };
}

export async function runCdfGenerationService(
  options: RunCdfGenerationServiceOptions,
): Promise<RunCdfGenerationServiceResult> {
  const { components, concurrency = DEFAULT_CONCURRENCY } = options;
  throwIfAborted(options.signal);
  const identities = components.map((component) => JSON.stringify([component.name, component.source]));
  if (new Set(identities).size !== identities.length) throw new Error('Duplicate component source identity');

  const resultComponents: CDFComponentEntry[] = [];
  const allWarnings: string[] = [];
  const failures: CdfGenerationFailure[] = [];
  const total = components.length;

  let cursor = 0;

  async function worker(): Promise<void> {
    while (!options.signal?.aborted && cursor < total) {
      const i = cursor++;
      const raw = components[i]!;
      const accepted = options.acceptedSlots?.filter(
        (decision) => decision.name === raw.name && decision.source === raw.source,
      );
      if (accepted)
        try {
          validateAcceptedSourceOwners(raw, accepted);
        } catch (error) {
          failures.push({ componentName: raw.name, error: error instanceof Error ? error.message : String(error) });
          continue;
        }
      const component = projectAcceptedRawSlots(raw, options.acceptedSlots);
      const result = await generateOne(component, options, i, total);
      throwIfAborted(options.signal);
      if (result.failure) {
        failures.push(result.failure);
      } else if (result.entry) {
        resultComponents.push(result.entry);
      }
      allWarnings.push(...result.warnings);
    }
  }

  const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, total) }, worker));
  throwIfAborted(options.signal);
  const failed = settled.find((entry): entry is PromiseRejectedResult => entry.status === 'rejected');
  if (failed) throw failed.reason;

  return { components: resultComponents, warnings: allWarnings, failures };
}
import { validateAcceptedSourceOwners } from '../../../exploration/src/services/source-input-ownership.js';
