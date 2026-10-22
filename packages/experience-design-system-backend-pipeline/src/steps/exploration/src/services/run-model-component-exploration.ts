import {
  deriveEditableRepresentationPlans,
  ModelComponentExplorationSchema,
  validateRepresentationPlan,
  cloneJson,
  own,
  type CDFComponentEntry,
  type ModelComponentExploration,
  type RepresentationPlan,
  type SharedSource,
} from '@contentful/experience-design-system-types';
import { buildPrompt } from '../../../../agents/prompts/build-prompt.js';
import type { ComponentSourceRef } from '../../../../agents/types/prompts.js';
import { runStageWithRetries } from '../../../../agents/helpers/run-stage-with-retries.js';
import { throwIfAborted } from '../../../../helpers/abort.js';
import { parseJsonOutput } from '../parsers/parse-explore-output.js';
import type { StageOptions } from '../types.js';
import { prepareDiagnosticPrompt } from '../../../../source-evidence/prompt-diagnostics.js';

export interface RunModelComponentExplorationRequest extends StageOptions {
  plan: RepresentationPlan;
  sourceOwner: { name: string; source: string };
  sharedSource?: SharedSource;
  sourceRefs?: ComponentSourceRef[];
  explorationJudgmentsInline?: string;
  reservedNames: ReadonlySet<string>;
  onModelStart?: (modelKey: string) => void;
  onModelComplete?: (report: ModelComponentExploration) => void | Promise<void>;
}

/** Backfilling exploration must preserve saved review metadata and defaults. */
function preserveModelMetadata(previous: RepresentationPlan, next: RepresentationPlan): RepresentationPlan {
  const originalKeys = new Map(next.models.map((model) => [model.key, model.originalKey]));
  const edits: Record<string, CDFComponentEntry> = Object.create(null);
  const renames: Record<string, string> = Object.create(null);
  for (const model of next.models) {
    const prior = previous.models.find((item) => item.originalKey === model.originalKey);
    const entry = cloneJson(model.entry);
    delete entry.$model;
    if (prior?.entry.$description?.trim()) entry.$description = prior.entry.$description;
    for (const [name, field] of Object.entries(entry.$properties)) {
      const old = prior?.entry.$properties[name];
      if (old && own(old, '$default')) field.$default = cloneJson(old.$default!);
      if (old?.$description?.trim()) field.$description = old.$description;
    }
    for (const [name, slot] of Object.entries(entry.$slots ?? {})) {
      if (slot.$modelBinding) slot.$modelBinding.planId = '';
      slot.$allowedComponents = slot.$allowedComponents?.map((key) => originalKeys.get(key) ?? key);
      const old = prior?.entry.$slots?.[name];
      if (old?.$description?.trim()) slot.$description = old.$description;
    }
    edits[model.originalKey] = entry;
    renames[model.originalKey] = prior && prior.key !== prior.originalKey ? prior.key : model.key;
  }
  const plan = deriveEditableRepresentationPlans(next.sourceModel, {
    context: next.contextSnapshot,
    defaultIntent: next.defaultIntent,
    modelExplorations: next.modelExplorations,
    modelEdits: edits,
    modelRenames: renames,
    ...(next.proposal ? { proposal: next.proposal } : {}),
  }).find((choice) => choice.kind === 'component-model');
  if (!plan) throw new Error('Explored model cannot preserve saved review metadata');
  return plan;
}

/** Explore each new dependency without restarting its owner's completed exploration run. */
export async function runModelComponentExploration(
  request: RunModelComponentExplorationRequest,
): Promise<RepresentationPlan> {
  let plan = request.plan;
  const reports = [...(plan.modelExplorations ?? [])];
  for (const generated of request.plan.models) {
    throwIfAborted(request.signal);
    if (reports.some((report) => report.modelKey === generated.originalKey)) continue;
    request.onModelStart?.(generated.key);
    const result = await runStageWithRetries(
      {
        ...request,
        component: generated.key,
        source: request.sourceOwner.source,
        maxAttempts: request.maxAttempts ?? 2,
      },
      'explore-model',
      () =>
        prepareDiagnosticPrompt(
          request.sharedSource?.diagnostics,
          (diagnostics) =>
            buildPrompt({
              signal: request.signal,
              skill: 'explore-model',
              mode: 'autonomous',
              outDir: request.outDir,
              sharedSource: request.sharedSource ? { ...request.sharedSource, diagnostics } : undefined,
              componentSourceRefs: request.sourceRefs,
              explorationJudgmentsInline: request.explorationJudgmentsInline,
              stageAssignmentInline: JSON.stringify({
                scope: 'explore-model',
                sourceOwner: request.sourceOwner,
                property: plan.identity.key,
                modelKey: generated.originalKey,
                nodeId: generated.nodeId,
                sourceRevision: plan.identity.sourceRevision,
                reservedNames: [...request.reservedNames, ...reports.map((report) => report.name)],
              }),
              stageInputInline: JSON.stringify({
                derivedDefinition: generated.entry,
                logicalGraph: plan.logicalGraph,
                propertySource: plan.sourceModel.source,
                fieldMappings: plan.mappings.filter((mapping) => mapping.componentKey === generated.key),
                runtimeRequirements: plan.requirements,
              }),
            }),
          request.signal,
        ),
      (output) => {
        const report = ModelComponentExplorationSchema.parse(parseJsonOutput(output));
        if (request.reservedNames.has(report.name) || reports.some((item) => item.name === report.name))
          throw new Error('Model exploration name collides with another component');
        const derived = deriveEditableRepresentationPlans(plan.sourceModel, {
          context: plan.contextSnapshot,
          defaultIntent: plan.defaultIntent,
          ...(plan.proposal ? { proposal: plan.proposal } : {}),
          modelExplorations: [...reports, report],
        }).find((choice) => choice.kind === 'component-model');
        if (!derived) throw new Error('Explored component model is unavailable');
        const next = preserveModelMetadata(request.plan, derived);
        const issues = validateRepresentationPlan(next, plan.sourceModel, plan.contextSnapshot);
        if (issues.length) throw new Error(issues.map((issue) => issue.message).join('; '));
        if (report.modelKey !== generated.originalKey)
          throw new Error('Model exploration answered a different component');
        return { report, plan: next };
      },
    );
    if (!result.ok)
      throw new Error(`Model exploration for ${request.sourceOwner.name}.${plan.identity.key}: ${result.error}`);
    reports.push(result.value.report);
    plan = result.value.plan;
    await request.onModelComplete?.(result.value.report);
  }
  return plan;
}
