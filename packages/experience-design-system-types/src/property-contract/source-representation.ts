import type { PropertySourceGraph, SourceGraphNode } from './property-model.js';
import { jsonEqual, type JsonValue } from './json-value.js';

export const SOURCE_BOUND_REPRESENTATIONS = ['RichText', 'JSON', 'ResourceLink'] as const;
export function isSourceBoundRepresentation(type: string): boolean {
  return (SOURCE_BOUND_REPRESENTATIONS as readonly string[]).includes(type);
}

/** Defaults and observed callers do not establish a closed input domain. */
export function finiteSourceValueDomain(graph: PropertySourceGraph, nodeId = graph.rootId): JsonValue[] | undefined {
  if (graph.coverage !== 'complete-within-declared-bound' || graph.omittedCount) return;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const visit = (id: string, active: Set<string>): JsonValue[] | undefined => {
    const node = nodes.get(id);
    if (!node || active.has(id) || node.coverage !== 'complete-within-declared-bound') return;
    const next = new Set(active).add(id);
    let values: JsonValue[] | undefined;
    if (node.kind === 'union' || node.kind === 'reference') {
      const members = (node.alternatives ?? []).map((ref) => visit(ref, next));
      if (members.length && members.every((member) => member !== undefined)) {
        values = [];
        for (const value of members.flat() as JsonValue[])
          if (!values.some((existing) => jsonEqual(existing, value))) values.push(value);
      }
    } else if (
      ['string', 'number', 'boolean', 'null'].includes(node.kind) &&
      node.domain.provenance === 'compiler' &&
      node.domain.openness === 'closed' &&
      !node.domain.unrepresentedValues?.length
    )
      values = node.domain.declaredValues;
    const nullability = node.nullability;
    if (
      !values?.length ||
      !nullability ||
      nullability.compilerMode !== 'enabled' ||
      nullability.null.source !== 'compiler' ||
      nullability.undefined.source !== 'compiler' ||
      nullability.null.state !== (values.includes(null) ? 'present' : 'absent') ||
      nullability.undefined.state !== 'absent'
    )
      return;
    return values;
  };
  return visit(nodeId, new Set());
}

export function sourceJsonCompatibility(graph: PropertySourceGraph): 'compatible' | 'unresolved' | 'contradicted' {
  if (graph.coverage !== 'complete-within-declared-bound' || graph.omittedCount) return 'unresolved';
  let unresolved = false;
  for (const node of graph.nodes) {
    if (
      ['undefined', 'never', 'bigint', 'symbol', 'function'].includes(node.kind) ||
      node.nullability?.undefined.state === 'present' ||
      node.domain.unrepresentedValues?.length ||
      node.callSignatures?.length ||
      node.indexSignatures?.some((index) => index.keyType === 'symbol')
    )
      return 'contradicted';
    if (
      !node.nullability ||
      node.nullability.undefined.state === 'unknown' ||
      node.kind === 'unknown' ||
      node.coverage !== 'complete-within-declared-bound' ||
      (node.kind === 'record' && !node.fields?.length && !node.indexSignatures?.length) ||
      node.indexSignatures?.some((index) => !['string', 'number'].includes(index.keyType))
    )
      unresolved = true;
  }
  return unresolved ? 'unresolved' : 'compatible';
}

/** Inspect only input-domain branches, not primitive fields within a structured document. */
export function sourceDomainHasKind(graph: PropertySourceGraph, kinds: readonly string[]): boolean {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const visit = (node: SourceGraphNode | undefined): boolean => {
    if (!node || seen.has(node.id)) return false;
    seen.add(node.id);
    return (
      kinds.includes(node.kind) ||
      (['union', 'intersection', 'reference'].includes(node.kind) &&
        (node.alternatives ?? []).some((id) => visit(nodes.get(id))))
    );
  };
  return visit(nodes.get(graph.rootId));
}
