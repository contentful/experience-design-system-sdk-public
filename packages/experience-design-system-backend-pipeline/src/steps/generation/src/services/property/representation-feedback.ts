import {
  cloneJson,
  type ClassifiedPropertyCall,
  type PropertyIssue,
  type PropertyProjection,
  type RepresentationAlternative,
  type RepresentationPlan,
} from '@contentful/experience-design-system-types';
import type { RawComponentDefinition } from '../../../../extraction/src/types/component.js';
import { materializeProperty } from './materialize-property.js';

export interface PropertyRepresentationFeedback {
  subject: string;
  property: string;
  outcome: PropertyProjection['outcome'] | 'unresolved';
  issues: PropertyIssue[];
  requirements: PropertyProjection['requirements'];
  alternatives: RepresentationAlternative[];
  representationPlans: Array<
    Pick<RepresentationPlan, 'kind' | 'nativeDefinition' | 'sdkValid' | 'issues' | 'requirements'>
  >;
  draftDecision: ClassifiedPropertyCall;
  repairInstruction: string;
}

export interface PropertyDecisionValidation {
  state: 'ready' | 'pending';
  retainedCall: ClassifiedPropertyCall;
  feedback?: PropertyRepresentationFeedback;
}

function unresolvedDecision(call: ClassifiedPropertyCall): ClassifiedPropertyCall {
  return {
    tool: 'classify_prop',
    prop: call.prop,
    cdf_category: call.cdf_category,
    ...(call.description !== undefined ? { description: call.description } : {}),
    ...(call.source_revision !== undefined ? { source_revision: call.source_revision } : {}),
    ...(call.source_node_id !== undefined ? { source_node_id: call.source_node_id } : {}),
    reason: call.reason?.trim() || 'Source semantics retained; representation requires validation.',
  };
}

/** The same source binding, CDF and projection rules govern host and draft validation. */
export function validateGenerationPropertyDecision(
  component: RawComponentDefinition,
  call: ClassifiedPropertyCall,
  componentId = component.name,
): PropertyDecisionValidation {
  // Bind retained semantics first so invalid representation metadata cannot hide stale source identity.
  const retainedCall = unresolvedDecision(call);
  const retained = materializeProperty(component, retainedCall, componentId);
  let materialized = retained;
  let issues: PropertyIssue[];
  try {
    materialized = materializeProperty(component, call, componentId);
    if (
      materialized.definition &&
      (!materialized.projection || ['supported', 'lossy'].includes(materialized.projection.outcome))
    )
      return { state: 'ready', retainedCall: cloneJson(call) };
    issues = materialized.projection?.issues ?? [{ path: '/representation', message: 'No representation decision' }];
  } catch (error) {
    issues = [{ path: '/representation', message: error instanceof Error ? error.message : 'Invalid representation' }];
  }
  if (!retained.model)
    issues = [
      ...issues,
      { path: '/source', message: 'Complete source graph unavailable; representation proof is unknown' },
    ];
  const requirements = materialized.projection?.requirements ?? [];
  if (!retained.model) requirements.push({ path: '/source', capability: 'source-graph', availability: 'unknown' });
  const feedback: PropertyRepresentationFeedback = {
    subject: `property:${call.prop}`,
    property: call.prop,
    outcome: materialized.projection?.outcome ?? 'unresolved',
    issues,
    requirements,
    alternatives: cloneJson(retained.alternatives ?? []),
    representationPlans: (retained.representationPlans ?? []).map((plan) => ({
      kind: plan.kind,
      ...(plan.nativeDefinition ? { nativeDefinition: cloneJson(plan.nativeDefinition) } : {}),
      sdkValid: plan.sdkValid,
      issues: cloneJson(plan.issues),
      requirements: cloneJson(plan.requirements),
    })),
    draftDecision: cloneJson(call),
    repairInstruction:
      'Repair only the representation from supplied source facts; preserve the exact property, semantic category and source identity. Candidate alternatives are unapproved and their mapper, cardinality and other requirements remain explicit. If evidence or capabilities are missing, omit cdf_type and all representation companions and explain the concrete remaining limitation in reason. Never substitute a generic type, narrow an open domain, exclude the retained property or invent mapper support.',
  };
  retainedCall.reason = `${retainedCall.reason} Representation pending: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}${requirements
    .filter((requirement) => requirement.availability !== 'enabled')
    .map((requirement) => `; ${requirement.path}: ${requirement.capability} ${requirement.availability}`)
    .join('')}`;
  return { state: 'pending', retainedCall, feedback };
}
