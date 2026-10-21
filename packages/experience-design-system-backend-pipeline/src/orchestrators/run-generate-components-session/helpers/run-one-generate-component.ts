import type { AgentDebugEvent } from '../../../agents/types/agent-run.js';
import { bucketComponentProps } from '@contentful/experience-design-system-extraction';
import { stripPropProvenance } from '../../../agents/prompts/helpers/strip-prop-provenance.js';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentName } from '../../../agents/types/agent-name.js';
import type { AgentInvoker } from '../../../agents/types/invoker.js';
import { buildPrompt } from '../../../agents/prompts/build-prompt.js';
import { buildCompilerEvidenceInline } from '../../../agents/prompts/helpers/build-compiler-evidence-inline.js';
import { invokeAgentWithOutput } from '../../../agents/services/invoke-agent-with-output.js';
import { generateCompleteDecisions } from '../../../steps/generation/src/services/property/complete-decisions.js';
import { componentDecisionInventory } from '../../../steps/generation/src/services/property/decision-inventory.js';
import { loadAcceptedSlotDecisions } from '../../../persistence/src/session/repositories/exploration/records.js';
import {
  applyToolCalls,
  computeComponentInputHash,
  loadSavedComponentSourceRef,
  loadSavedSharedSource,
  renameEmptySlots,
  storeCache,
  type RawComponentWithId,
} from '../../../persistence/src/session/repositories/db.js';
import { normalizeComponentForCache } from '../../../steps/generation/src/helpers/components/normalize-component-for-cache.js';
import { summarizeForGenerateAgent } from '../../../steps/generation/src/controller/existing-entities/summarize-for-generate.js';
import type { ExistingContentfulEntities } from '../../../steps/generation/src/types/existing-entities.js';
import type { GeneratedComponentResult, GenerateComponentsProgress } from '../types.js';
import { buildFailedComponentResult } from './build-failed-component-result.js';
import { buildExplorationJudgmentsInline } from './build-exploration-judgments-inline.js';
import { throwIfAborted } from '../../../helpers/abort.js';
import {
  loadExplorationRun,
  loadExplorationRecord,
} from '../../../persistence/src/session/repositories/exploration/records.js';

const DEFAULT_TIMEOUT_MS = Number(process.env['EDS_AGENT_TIMEOUT_MS'] ?? 5 * 60 * 1000);
const RETRY_BACKOFF_MS = Number(process.env['EDS_RETRY_BACKOFF_MS'] ?? 5_000);

export interface RunOneGenerateComponentOptions {
  explorationRunIds?: { componentRunId: string; detailRunId: string };
  db: DatabaseSync;
  sessionId: string;
  invoker: AgentInvoker;
  agent: AgentName;
  model: string | undefined;
  tokensInline: string | undefined;
  tokenMapInline: string | undefined;
  verbose: boolean;
  noCache: boolean;
  skillPathOverride: string | undefined;
  skillContentOverride: string | undefined;
  promptHash: string;
  existingContentfulEntities: ExistingContentfulEntities | null | undefined;
  existingTokensInline: string | undefined;
  compilerEvidenceInline?: string;
  precomputedCachedNames: ReadonlySet<string>;
  allowedComponentNames: ReadonlySet<string>;
  onProgress: ((event: GenerateComponentsProgress) => void) | undefined;
  onDebugEvent?: AgentDebugEvent;
  signal?: AbortSignal;
}

export async function runOneGenerateComponent(
  options: RunOneGenerateComponentOptions,
  component: RawComponentWithId,
  index: number,
  total: number,
): Promise<GeneratedComponentResult> {
  const {
    db,
    sessionId,
    invoker,
    agent,
    model,
    tokensInline,
    tokenMapInline,
    verbose,
    noCache,
    skillPathOverride,
    skillContentOverride,
    promptHash,
    existingContentfulEntities,
    existingTokensInline,
    allowedComponentNames,
    onProgress,
    signal,
  } = options;

  throwIfAborted(signal);
  const assertProjectionCurrent = (): void => {
    const expected = options.explorationRunIds;
    if (
      expected &&
      (loadExplorationRun(db, sessionId, 'components')?.runId !== expected.componentRunId ||
        loadExplorationRun(db, sessionId, 'detail')?.runId !== expected.detailRunId ||
        !loadExplorationRecord(db, sessionId, 'detail', 'detail'))
    )
      throw new Error('Accepted generation scope or source changed');
  };
  assertProjectionCurrent();
  const compilerEvidenceInline =
    options.compilerEvidenceInline ?? buildCompilerEvidenceInline([component], { readiness: 'caller-provided' });
  const explorationJudgmentsInline = options.explorationRunIds
    ? buildExplorationJudgmentsInline(db, sessionId, component, options.explorationRunIds)
    : undefined;
  const { renames } = options.explorationRunIds
    ? { renames: [] }
    : renameEmptySlots(db, sessionId, component.component_id, component.name, component.slots.length);
  let effectiveSlots = component.slots;
  if (renames.length > 0) {
    const renameMap = new Map(renames.map((r) => [r.oldName, r.newName]));
    effectiveSlots = component.slots.map((s) => (renameMap.has(s.name) ? { ...s, name: renameMap.get(s.name)! } : s));
    for (const rename of renames) {
      onProgress?.({
        kind: 'component:slot-renamed',
        componentName: component.name,
        oldName: rename.oldName,
        newName: rename.newName,
      });
    }
  }
  throwIfAborted(signal);
  effectiveSlots = effectiveSlots.map((slot) =>
    slot.allowedComponents
      ? { ...slot, allowedComponents: slot.allowedComponents.filter((name) => allowedComponentNames.has(name)) }
      : slot,
  );
  const cacheComponent = normalizeComponentForCache(component);

  const componentBuckets = bucketComponentProps(component);
  options.onDebugEvent?.('prop-buckets.generate', { ...componentBuckets });

  const rawComponentsInline = JSON.stringify(
    [
      {
        name: component.name,
        source: component.source,
        framework: component.framework,
        props: component.props.map(stripPropProvenance),
        slots: effectiveSlots,
      },
    ],
    null,
    2,
  );
  const shared = loadSavedSharedSource(db, sessionId, { componentIds: [component.component_id] });
  const sourceRef = loadSavedComponentSourceRef(
    db,
    sessionId,
    component.component_id,
    component.name,
    component.sourcePath ?? component.source,
    component.props.map((p) => p.name),
    component.props.map((p) => p.type),
  );
  throwIfAborted(signal);
  const existingComponentsInline = existingContentfulEntities
    ? JSON.stringify(summarizeForGenerateAgent(existingContentfulEntities, component.name))
    : undefined;
  const prompt = await buildPrompt({
    skill: 'components',
    mode: 'autonomous',
    rawComponentsInline,
    compilerEvidenceInline,
    explorationJudgmentsInline,
    propBucketsInline: JSON.stringify(componentBuckets),
    tokensInline,
    tokenMapInline,
    outDir: process.cwd(),
    componentName: component.name,
    sharedSource: shared.readiness === 'ready' && shared.source.components.length ? shared.source : undefined,
    componentSourceRefs: [sourceRef],
    skillPathOverride,
    skillContentOverride,
    existingComponentsInline,
    existingTokensInline,
    componentAllowlistInline: JSON.stringify([...allowedComponentNames].sort()),
  });
  throwIfAborted(signal);

  const inventory = componentDecisionInventory(
    { ...component, slots: effectiveSlots },
    loadAcceptedSlotDecisions(db, sessionId),
  );
  const completed = await generateCompleteDecisions({
    originalPrompt: prompt,
    inventory,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    backoffMs: RETRY_BACKOFF_MS,
    signal,
    representationValidation: { component, componentId: component.component_id },
    invoke: async ({ prompt: attemptPrompt, timeoutMs, signal: operationSignal, attempt }) => {
      onProgress?.({ kind: 'component:started', index, total, name: component.name, attempt, maxAttempts: 2 });
      throwIfAborted(signal);
      return (
        await invokeAgentWithOutput(
          invoker,
          { agent, model, prompt: attemptPrompt, timeoutMs, signal: operationSignal },
          verbose,
        )
      ).result;
    },
  });
  throwIfAborted(signal);
  if (!completed.complete) {
    const error = completed.diagnostics.join('; ');
    onProgress?.({ kind: 'component:failed', index, total, name: component.name, error });
    return buildFailedComponentResult(component.name, error, renames.length);
  }
  const calls = completed.calls;
  const warnings = completed.diagnostics;
  assertProjectionCurrent();
  const applied = applyToolCalls(db, sessionId, component.component_id, component.name, calls, warnings, {
    allowedComponentNames,
  });
  throwIfAborted(signal);
  if (applied.projectionBlocked)
    return buildFailedComponentResult(component.name, applied.warnings.join('; '), renames.length);
  if (!noCache) {
    storeCache(
      db,
      computeComponentInputHash(cacheComponent),
      'component',
      component.component_id,
      sessionId,
      false,
      promptHash,
    );
  }
  onProgress?.({
    kind: 'component:completed',
    index,
    total,
    name: component.name,
    classified: applied.classified,
    excluded: applied.excluded,
    slots: applied.slots,
    warnings: applied.warnings,
  });
  return {
    componentName: component.name,
    classified: applied.classified,
    excluded: applied.excluded,
    slots: applied.slots,
    warnings: applied.warnings,
    failed: false,
    cached: false,
    renamedSlotsCount: renames.length,
  };
}
