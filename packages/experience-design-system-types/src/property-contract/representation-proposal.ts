import { cloneJson, freezeJson, jsonValueIssue, type JsonValue, type PropertyIssue } from './json-value.js';
import {
  validateTargetDefinition,
  TARGET_PROPERTY_TYPES,
  type TargetPropertyType,
  type TargetDefinition,
} from './target-definition.js';
import { validateSourceGraph, type MapperAvailability, type PropertyModel } from './property-model.js';

export interface RepresentationProposalDraft {
  componentId: string;
  propertyId: string;
  key: string;
  name: string;
  sourceRevision: string;
  sourceNodeIds: string[];
  declaredConstraints: Array<{ nodeId: string; statement: string }>;
  provenConstraints: Array<{ nodeId: string; statement: string }>;
  observations: Array<{ nodeId: string; value: JsonValue }>;
  judgment: string;
  desiredType: TargetPropertyType;
  desiredDefinition: TargetDefinition;
}
export interface MapperReadiness {
  requirements: Array<{ path: string; capability: string; availability: MapperAvailability }>;
  status: MapperAvailability;
}
export interface ValidatedRepresentationProposal {
  draft: Readonly<RepresentationProposalDraft>;
  readiness: Readonly<MapperReadiness>;
}
export function validateProposalDraft(input: unknown): PropertyIssue[] {
  const unsafe = jsonValueIssue(input);
  if (unsafe) return [unsafe];
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return [{ path: '', message: 'Expected proposal draft' }];
  const draft = input as RepresentationProposalDraft;
  const issues: PropertyIssue[] = [];
  const keys = [
    'componentId',
    'propertyId',
    'key',
    'name',
    'sourceRevision',
    'sourceNodeIds',
    'declaredConstraints',
    'provenConstraints',
    'observations',
    'judgment',
    'desiredType',
    'desiredDefinition',
  ];
  for (const key of Object.keys(draft))
    if (!keys.includes(key))
      issues.push({ path: `/${key}`, message: 'Unexpected draft member; readiness is caller-owned' });
  for (const key of ['componentId', 'propertyId', 'key', 'name', 'sourceRevision', 'judgment'] as const)
    if (typeof draft[key] !== 'string' || !draft[key])
      issues.push({ path: `/${key}`, message: 'Expected nonempty string' });
  if (
    !Array.isArray(draft.sourceNodeIds) ||
    !draft.sourceNodeIds.length ||
    !draft.sourceNodeIds.every((id) => typeof id === 'string') ||
    new Set(draft.sourceNodeIds).size !== draft.sourceNodeIds.length
  )
    issues.push({ path: '/sourceNodeIds', message: 'Expected unique source node identities' });
  for (const channel of ['declaredConstraints', 'provenConstraints', 'observations'] as const) {
    const values = draft[channel];
    if (!Array.isArray(values)) {
      issues.push({ path: `/${channel}`, message: 'Expected evidence list' });
      continue;
    }
    values.forEach((value, i) => {
      const allowed = channel === 'observations' ? ['nodeId', 'value'] : ['nodeId', 'statement'];
      if (
        !value ||
        typeof value !== 'object' ||
        typeof value.nodeId !== 'string' ||
        Object.keys(value).some((key) => !allowed.includes(key)) ||
        (channel === 'observations'
          ? !Object.hasOwn(value, 'value')
          : typeof (value as { statement?: unknown }).statement !== 'string')
      )
        issues.push({ path: `/${channel}/${i}`, message: 'Invalid evidence reference' });
    });
  }
  if (!TARGET_PROPERTY_TYPES.includes(draft.desiredType) || draft.desiredDefinition?.type !== draft.desiredType)
    issues.push({ path: '/desiredType', message: 'Desired type disagrees with definition' });
  for (const issue of validateTargetDefinition(draft.desiredDefinition).issues)
    issues.push({ path: `/desiredDefinition${issue.path}`, message: issue.message });
  return issues;
}
export function validateRepresentationProposal(
  input: unknown,
  model: PropertyModel,
  mapperReadinessFor: (draft: Readonly<RepresentationProposalDraft>) => MapperReadiness,
): { valid: boolean; issues: PropertyIssue[]; proposal?: ValidatedRepresentationProposal } {
  const issues = validateProposalDraft(input);
  if (issues.length) return { valid: false, issues };
  const draft = input as RepresentationProposalDraft;
  for (const key of ['componentId', 'propertyId', 'key', 'sourceRevision'] as const)
    if (draft[key] !== model.identity[key])
      issues.push({ path: `/${key}`, message: 'Stale or mismatched source identity' });
  issues.push(...validateSourceGraph(model.source.graph));
  const ids = new Set(model.source.graph.nodes.map((node) => node.id));
  for (const id of [
    ...draft.sourceNodeIds,
    ...draft.declaredConstraints.map((c) => c.nodeId),
    ...draft.provenConstraints.map((c) => c.nodeId),
    ...draft.observations.map((o) => o.nodeId),
  ])
    if (!ids.has(id)) issues.push({ path: '/sourceNodeIds', message: 'Unknown source node reference' });
  if (!draft.sourceNodeIds.includes(model.identity.nodeId))
    issues.push({ path: '/sourceNodeIds', message: 'Property source root missing' });
  if (issues.length) return { valid: false, issues };
  const frozen = freezeJson(cloneJson(draft));
  const readiness = mapperReadinessFor(frozen);
  const unsafe = jsonValueIssue(readiness);
  if (
    unsafe ||
    !readiness ||
    !Array.isArray(readiness.requirements) ||
    readiness.requirements.some(
      (r) =>
        !r ||
        typeof r.path !== 'string' ||
        typeof r.capability !== 'string' ||
        !['enabled', 'unavailable', 'unknown'].includes(r.availability) ||
        Object.keys(r).some((key) => !['path', 'capability', 'availability'].includes(key)),
    ) ||
    Object.keys(readiness).some((key) => !['requirements', 'status'].includes(key))
  )
    return { valid: false, issues: [{ path: '/readiness', message: 'Invalid caller readiness' }] };
  const status = readiness.requirements.some((r) => r.availability === 'unavailable')
    ? 'unavailable'
    : readiness.requirements.some((r) => r.availability === 'unknown')
      ? 'unknown'
      : 'enabled';
  if (readiness.status !== status)
    return { valid: false, issues: [{ path: '/readiness/status', message: 'Contradictory readiness summary' }] };
  return { valid: true, issues: [], proposal: { draft: frozen, readiness: freezeJson(cloneJson(readiness)) } };
}
/** Staged transport has no apply, database or readiness side effects. */
export function parseRepresentationProposalDrafts(stdout: string): {
  drafts: RepresentationProposalDraft[];
  warnings: string[];
} {
  const drafts: RepresentationProposalDraft[] = [];
  const warnings: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      const issues = validateProposalDraft(value);
      if (issues.length) warnings.push(...issues.map((i) => `${i.path}: ${i.message}`));
      else drafts.push(cloneJson(value as RepresentationProposalDraft));
    } catch {
      warnings.push('Invalid proposal JSON');
    }
  }
  return { drafts, warnings };
}
