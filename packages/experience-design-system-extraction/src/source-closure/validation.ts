import type { ComponentSourceObservationCollection } from '../extract/types/component-source-observations.js';
import type { SourceClosureEvidence } from './source-evidence.js';
import { sourceClosureIdentity } from './source-evidence.js';
type RecordValue = Record<string, unknown>;
function plain(value: unknown): value is RecordValue {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
function keys(value: RecordValue, required: string[], optional: string[] = []): boolean {
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key))
  );
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
function integer(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
}
function array(value: unknown, check: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(check);
}
function json(value: unknown, active = new Set<object>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if ((!plain(value) && !Array.isArray(value)) || active.has(value)) return false;
  active.add(value);
  try {
    if (Object.getOwnPropertySymbols(value).length) return false;
    if (
      Array.isArray(value) &&
      (Object.keys(value).length !== value.length ||
        Object.keys(value).some(
          (key) =>
            !Number.isSafeInteger(Number(key)) ||
            Number(key) < 0 ||
            Number(key) >= value.length ||
            String(Number(key)) !== key,
        ))
    )
      return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Object.entries(descriptors).every(([key, descriptor]) =>
      Array.isArray(value) && key === 'length'
        ? true
        : 'value' in descriptor && descriptor.enumerable === true && json(descriptor.value, active),
    );
  } finally {
    active.delete(value);
  }
}
function location(value: unknown): boolean {
  if (
    !plain(value) ||
    !keys(
      value,
      ['fileId', 'canonicalPath', 'textHash', 'startLine', 'endLine', 'binding'],
      ['startOffset', 'endOffset'],
    )
  )
    return false;
  return (
    (value.fileId === null || text(value.fileId)) &&
    (value.canonicalPath === null || text(value.canonicalPath)) &&
    (value.textHash === null || text(value.textHash)) &&
    [value.startLine, value.endLine].every((line) => line === null || integer(line, 1)) &&
    [value.startOffset, value.endOffset].every(
      (offset) => offset === undefined || offset === null || integer(offset, 0),
    ) &&
    ['verified', 'changed', 'unverified', 'unavailable'].includes(value.binding as string) &&
    (value.startLine === null || value.endLine === null || (value.endLine as number) >= (value.startLine as number)) &&
    (value.startOffset == null ||
      value.endOffset == null ||
      (value.endOffset as number) >= (value.startOffset as number))
  );
}
export { json as isPlainSourceContract, location as isSourceFactLocation };
function node(value: unknown): boolean {
  if (
    !plain(value) ||
    !keys(value, ['id', 'location', 'observationIds', 'edges', 'ends']) ||
    !text(value.id) ||
    !location(value.location) ||
    !strings(value.observationIds)
  )
    return false;
  const loc = value.location as SourceClosureEvidence['nodes'][number]['location'];
  if (
    !loc.canonicalPath ||
    !loc.textHash ||
    loc.startOffset == null ||
    loc.endOffset == null ||
    sourceClosureIdentity(loc) !== value.id
  )
    return false;
  return (
    array(
      value.edges,
      (edge) =>
        plain(edge) &&
        keys(edge, ['target', 'kind']) &&
        text(edge.target) &&
        ['call', 'jsx'].includes(edge.kind as string),
    ) &&
    array(
      value.ends,
      (end) =>
        plain(end) &&
        keys(end, ['kind', 'reason'], ['target', 'observationId']) &&
        ['open', 'dead'].includes(end.kind as string) &&
        text(end.reason) &&
        (end.target === undefined || text(end.target)) &&
        (end.observationId === undefined || (value.observationIds as string[]).includes(end.observationId as string)),
    )
  );
}
const observationKinds = [
  'declaration',
  'binding',
  'call',
  'return',
  'assignment',
  'comparison',
  'condition',
  'member-read',
  'annotation',
  'throw',
  'assertion',
  'jsx',
  'jsx-attribute',
  'spread',
];
function fact(value: unknown): boolean {
  return (
    plain(value) &&
    keys(value, ['observationId', 'ownerId', 'kind', 'strength', 'dependsOnOpenEnd', 'provenance']) &&
    text(value.observationId) &&
    text(value.ownerId) &&
    observationKinds.includes(value.kind as string) &&
    ['exact', 'inferred', 'unknown'].includes(value.strength as string) &&
    typeof value.dependsOnOpenEnd === 'boolean' &&
    strings(value.provenance)
  );
}
/** One strict guard is shared by public callers and the backend sidecar reader. */
export function readSourceClosure(
  value: unknown,
): { status: 'available'; evidence: SourceClosureEvidence } | { status: 'corrupt' | 'unsupported' | 'unknown-legacy' } {
  if (value === undefined) return { status: 'unknown-legacy' };
  if (!json(value) || !plain(value)) return { status: 'corrupt' };
  if (typeof value.schemaVersion === 'number' && value.schemaVersion !== 1) return { status: 'unsupported' };
  if (
    !keys(value, [
      'schemaVersion',
      'semantics',
      'captureBinding',
      'rootId',
      'status',
      'reason',
      'coverage',
      'binding',
      'nodes',
      'groups',
      'summaries',
      'reads',
      'omissions',
      'maxIterations',
    ]) ||
    !(
      value.captureBinding === null ||
      (plain(value.captureBinding) &&
        keys(value.captureBinding, [
          'captureId',
          'captureDigest',
          'envelopeId',
          'envelopeDigest',
          'sessionId',
          'extractionStepId',
        ]) &&
        ['captureId', 'captureDigest', 'envelopeId', 'envelopeDigest', 'sessionId'].every((key) =>
          text((value.captureBinding as RecordValue)[key]),
        ) &&
        integer(value.captureBinding.extractionStepId, 1))
    ) ||
    value.schemaVersion !== 1 ||
    value.semantics !== 'lexical-source' ||
    !text(value.rootId) ||
    !['available', 'partial', 'unavailable', 'failed'].includes(value.status as string) ||
    !(value.reason === null || text(value.reason)) ||
    !['complete-within-declared-bound', 'partial', 'unavailable'].includes(value.coverage as string) ||
    !['verified', 'changed', 'unverified', 'unavailable'].includes(value.binding as string) ||
    !integer(value.maxIterations, 1) ||
    !array(value.nodes, node) ||
    !array(
      value.groups,
      (group) =>
        plain(group) &&
        keys(group, ['members', 'cyclic']) &&
        strings(group.members) &&
        group.members.length > 0 &&
        typeof group.cyclic === 'boolean',
    ) ||
    !array(
      value.summaries,
      (summary) =>
        plain(summary) && keys(summary, ['nodeId', 'facts']) && text(summary.nodeId) && array(summary.facts, fact),
    ) ||
    !array(
      value.reads,
      (read) =>
        plain(read) &&
        keys(read, ['nodeId', 'outcome']) &&
        text(read.nodeId) &&
        ['read', 'missing'].includes(read.outcome as string),
    ) ||
    !array(
      value.omissions,
      (item) =>
        plain(item) &&
        keys(item, ['reason', 'location', 'count']) &&
        text(item.reason) &&
        (item.location === null || location(item.location)) &&
        integer(item.count, 1),
    )
  )
    return { status: 'corrupt' };
  const evidence = value as unknown as SourceClosureEvidence;
  const nodes = new Map(evidence.nodes.map((item) => [item.id, item]));
  const readIds = new Map(evidence.reads.map((item) => [item.nodeId, item.outcome]));
  const members = evidence.groups.flatMap((group) => group.members);
  const summaryIds = evidence.summaries.map((summary) => summary.nodeId);
  if (
    nodes.size !== evidence.nodes.length ||
    readIds.size !== evidence.reads.length ||
    members.length !== nodes.size ||
    new Set(members).size !== members.length ||
    members.some((id) => !nodes.has(id)) ||
    evidence.nodes.some(
      (item) => readIds.get(item.id) !== 'read' || item.edges.some((edge) => !readIds.has(edge.target)),
    ) ||
    evidence.reads.some((read) => (read.outcome === 'read' ? !nodes.has(read.nodeId) : nodes.has(read.nodeId))) ||
    new Set(summaryIds).size !== summaryIds.length ||
    summaryIds.some((id) => !nodes.has(id)) ||
    evidence.summaries.some(
      (summary) =>
        nodes
          .get(summary.nodeId)!
          .observationIds.some((id) => !summary.facts.some((fact) => fact.observationId === id)) ||
        new Set(summary.facts.map((item) => item.observationId)).size !== summary.facts.length ||
        summary.facts.some(
          (item) =>
            !nodes.get(item.ownerId)?.observationIds.includes(item.observationId) ||
            !item.provenance.includes(summary.nodeId) ||
            item.provenance.some((id) => !nodes.has(id)),
        ),
    )
  )
    return { status: 'corrupt' };
  if (
    evidence.status === 'failed'
      ? evidence.reason === null || evidence.summaries.length > 0
      : evidence.status === 'unavailable'
        ? evidence.reason === null
        : !nodes.has(evidence.rootId) || evidence.summaries.length !== nodes.size
  )
    return { status: 'corrupt' };
  if (!nodes.has(evidence.rootId) && readIds.get(evidence.rootId) !== 'missing') return { status: 'corrupt' };
  return { status: 'available', evidence };
}

/** Summary references must describe observations in the same compiler snapshot. */
export function sourceClosureMatchesObservations(
  evidence: SourceClosureEvidence,
  collection: ComponentSourceObservationCollection,
): boolean {
  if (evidence.rootId !== collection.componentDeclarationId) return false;
  const observations = new Map(collection.observations.map((item) => [item.id, item]));
  const grouped = new Map<string, string[]>();
  for (const item of collection.observations) {
    const owner = item.context.lexicalDeclaration
      ? sourceClosureIdentity(item.context.lexicalDeclaration)
      : collection.componentDeclarationId;
    const ids = grouped.get(owner) ?? [];
    ids.push(item.id);
    grouped.set(owner, ids);
  }
  if (
    evidence.nodes.some(
      (node) =>
        JSON.stringify([...node.observationIds].sort()) !== JSON.stringify([...(grouped.get(node.id) ?? [])].sort()),
    )
  )
    return false;
  return evidence.summaries.every((summary) =>
    summary.facts.every((fact) => observations.get(fact.observationId)?.kind === fact.kind),
  );
}
