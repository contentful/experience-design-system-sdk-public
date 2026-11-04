import {
  hasPropertyRepresentation,
  contentDigest,
  type ClassificationToolCall,
} from '@contentful/experience-design-system-types';

export const generationSubject = (call: ClassificationToolCall): string =>
  call.tool === 'classify_component'
    ? 'component'
    : call.tool === 'classify_slot'
      ? `slot:${call.slot}`
      : `property:${call.prop}`;

export const generationDraftDigest = (calls: readonly ClassificationToolCall[]): string =>
  contentDigest([...calls].sort((left, right) => generationSubject(left).localeCompare(generationSubject(right))));

/** Draft preflight and host admission preserve the same accepted semantics. */
export function mergeGenerationRepair(
  previous: ClassificationToolCall | undefined,
  call: ClassificationToolCall,
  pending: boolean,
): ClassificationToolCall {
  if (!previous) return call;
  const key = generationSubject(call);
  if (!pending && (previous.tool !== 'classify_prop' || hasPropertyRepresentation(previous)))
    throw new Error(`Duplicate or conflicting subject ${key}; accepted decision preserved`);
  if (
    previous.tool !== 'classify_prop' ||
    call.tool !== 'classify_prop' ||
    previous.cdf_category !== call.cdf_category ||
    (call.description !== undefined && call.description !== previous.description) ||
    (previous.source_revision !== undefined && previous.source_revision !== call.source_revision) ||
    (previous.source_node_id !== undefined && previous.source_node_id !== call.source_node_id)
  )
    throw new Error(`Representation repair changed retained semantics or source identity ${key}`);
  return { ...call, ...(previous.description !== undefined ? { description: previous.description } : {}) };
}
