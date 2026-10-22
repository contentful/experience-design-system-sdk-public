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
    issues = call.cdf_type
      ? (materialized.projection?.issues ?? [{ path: '/representation', message: 'No representation decision' }])
      : [
          {
            path: '/cdf_type',
            message: 'Every retained property requires a selected cdf_type before generation completes',
          },
        ];
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
      'Select a supported cdf_type and repair its representation from supplied source facts; preserve the exact property, semantic category and source identity. For nullable source inputs, select the underlying editable type and supply source-bound null_handling judgments when evidence establishes equivalence to omission. Keep distinct or unknown null behavior explicit. Candidate alternatives are unapproved and their mapper, cardinality and other requirements remain explicit. A retained property cannot finish generation without cdf_type. Never narrow an open domain, exclude the retained property to avoid representation repair or invent mapper support.',
  };
  return { state: 'pending', retainedCall: cloneJson(call), feedback };
}
