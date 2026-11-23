import { cloneJson, jsonEqual, own, type JsonValue } from './json-value.js';
import { sourceAllowsNull } from './authoring-presence.js';
import { validateSourceValue, type PropertySourceGraph, type SourceGraphNode } from './property-model.js';

function valueNode(graph: PropertySourceGraph, id: string, value: JsonValue): SourceGraphNode | undefined {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  let node = nodes.get(id);
  while (node && ['reference', 'union'].includes(node.kind)) {
    if (seen.has(node.id)) return undefined;
    seen.add(node.id);
    const alternative = (node.alternatives ?? []).find(
      (member) => !validateSourceValue(graph, value, '', member).length,
    );
    node = alternative ? nodes.get(alternative) : undefined;
  }
  return node;
}

export function projectSourceDefault(
  graph: PropertySourceGraph,
  value: JsonValue,
  nodeId = graph.rootId,
): JsonValue | undefined {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const original = nodes.get(nodeId);
  if (value === null && original && sourceAllowsNull(original, nodes)) return undefined;
  const preserveBranch = (projected: JsonValue): JsonValue | undefined =>
    original &&
    ['union', 'reference'].includes(original.kind) &&
    !jsonEqual(reconstructAuthoringValue(graph, projected, nodeId), value)
      ? undefined
      : projected;
  const node = valueNode(graph, nodeId, value);
  if (node?.kind === 'array' && node.items?.length === 1 && Array.isArray(value)) {
    const items = value.map((item) => projectSourceDefault(graph, item, node.items![0]!));
    return items.every((item) => item !== undefined) ? preserveBranch(items) : undefined;
  }
  if (node?.fields && value && typeof value === 'object' && !Array.isArray(value)) {
    const result = cloneJson(value);
    for (const field of node.fields) {
      if (!own(value, field.key)) continue;
      const projected = projectSourceDefault(graph, value[field.key]!, field.nodeId);
      if (projected === undefined) {
        if (value[field.key] !== null) return undefined;
        delete result[field.key];
      } else result[field.key] = projected;
    }
    return preserveBranch(result);
  }
  return cloneJson(value);
}

export function reconstructAuthoringValue(
  graph: PropertySourceGraph,
  value: JsonValue,
  nodeId = graph.rootId,
): JsonValue {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const reconstruct = (id: string, current: JsonValue, active = new Set<string>()): JsonValue => {
    const node = nodes.get(id);
    if (!node || active.has(id)) return cloneJson(current);
    if (['reference', 'union'].includes(node.kind)) {
      const next = new Set(active).add(id);
      let chosen: JsonValue | undefined;
      for (const memberId of node.alternatives ?? []) {
        const member = nodes.get(memberId);
        if (!member || ['null', 'undefined', 'never'].includes(member.kind)) continue;
        const candidate = reconstruct(memberId, current, next);
        if (!validateSourceValue(graph, candidate, '', memberId).length) {
          if (chosen !== undefined && !jsonEqual(chosen, candidate)) return cloneJson(current);
          chosen = candidate;
        }
      }
      return chosen ?? cloneJson(current);
    }
    if (node.kind === 'array' && node.items?.length === 1 && Array.isArray(current))
      return current.map((item) => reconstruct(node.items![0]!, item));
    if (node.fields && current && typeof current === 'object' && !Array.isArray(current)) {
      const result = cloneJson(current);
      for (const field of node.fields) {
        const child = nodes.get(field.nodeId);
        if (own(current, field.key))
          Object.defineProperty(result, field.key, {
            value: reconstruct(field.nodeId, current[field.key]!),
            enumerable: true,
            writable: true,
            configurable: true,
          });
        else if (field.required && child && sourceAllowsNull(child, nodes))
          Object.defineProperty(result, field.key, {
            value: null,
            enumerable: true,
            writable: true,
            configurable: true,
          });
      }
      return result;
    }
    return cloneJson(current);
  };
  return reconstruct(nodeId, value);
}
