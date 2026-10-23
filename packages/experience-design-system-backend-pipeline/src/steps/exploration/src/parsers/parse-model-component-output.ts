import {
  deriveEditableRepresentationPlans,
  ModelComponentExplorationSchema,
  validateRepresentationPlan,
  cloneJson,
  own,
  type CDFComponentEntry,
  type ModelComponentExploration,
  type RepresentationPlan,
} from '@contentful/experience-design-system-types';
import { parseJsonOutput } from './parse-explore-output.js';

export interface ModelExplorationEvidence {
  plan: RepresentationPlan;
  originalPlan: RepresentationPlan;
  reports: readonly ModelComponentExploration[];
  reservedNames: readonly string[];
  modelKey: string;
  sourceOwner: { name: string; source: string };
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

/** The agent draft validator and host admission use this same complete source-bound check. */
export function parseModelComponentOutput(output: string, evidence: ModelExplorationEvidence) {
  const { plan, reports } = evidence;
  const subject = `${evidence.sourceOwner.name}.${plan.identity.key} (${evidence.sourceOwner.source})`;
  const parsed = ModelComponentExplorationSchema.safeParse(parseJsonOutput(output));
  if (!parsed.success)
    throw new Error(
      `Model exploration for ${subject}: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  const report = parsed.data;
  if (report.modelKey !== evidence.modelKey)
    throw new Error(
      `Model exploration for ${subject}: expected modelKey ${evidence.modelKey}; received ${report.modelKey}`,
    );
  if (evidence.reservedNames.includes(report.name) || reports.some((item) => item.name === report.name))
    throw new Error(`Model exploration name ${report.name} collides with another component for ${subject}`);
  const derived = deriveEditableRepresentationPlans(plan.sourceModel, {
    context: plan.contextSnapshot,
    defaultIntent: plan.defaultIntent,
    ...(plan.proposal ? { proposal: plan.proposal } : {}),
    modelExplorations: [...reports, report],
  }).find((choice) => choice.kind === 'component-model');
  if (!derived) throw new Error(`Explored component model is unavailable for ${subject}`);
  const next = preserveModelMetadata(evidence.originalPlan, derived);
  const issues = validateRepresentationPlan(next, plan.sourceModel, plan.contextSnapshot);
  if (issues.length)
    throw new Error(
      `Model exploration for ${subject}: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`,
    );
  return { report, plan: next };
}
