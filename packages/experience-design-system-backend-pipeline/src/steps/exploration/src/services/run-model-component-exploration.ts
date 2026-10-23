import type {
  ModelComponentExploration,
  RepresentationPlan,
  SharedSource,
} from '@contentful/experience-design-system-types';
import { buildPrompt } from '../../../../agents/prompts/build-prompt.js';
import type { ComponentSourceRef } from '../../../../agents/types/prompts.js';
import { runStageWithRetries } from '../../../../agents/helpers/run-stage-with-retries.js';
import { throwIfAborted } from '../../../../helpers/abort.js';
import { parseModelComponentOutput, type ModelExplorationEvidence } from '../parsers/parse-model-component-output.js';
import { prepareExplorationValidator } from './exploration-validator-artifact.js';
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
    const validationEvidence: ModelExplorationEvidence = {
      plan,
      originalPlan: request.plan,
      reports: [...reports],
      reservedNames: [...request.reservedNames],
      modelKey: generated.originalKey,
      sourceOwner: request.sourceOwner,
    };
    const result = await runStageWithRetries(
      {
        ...request,
        preserveConversation: true,
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
        ).then((prompt) =>
          prepareExplorationValidator(prompt, { kind: 'model', evidence: validationEvidence }, request.signal),
        ),
      (output) => parseModelComponentOutput(output, validationEvidence),
    );
    if (!result.ok)
      throw new Error(`Model exploration for ${request.sourceOwner.name}.${plan.identity.key}: ${result.error}`);
    reports.push(result.value.report);
    plan = result.value.plan;
    await request.onModelComplete?.(result.value.report);
  }
  return plan;
}
