import type { NativeSourceShape, SourceTypeGraph, SourceTypeNode } from './types.js';

/** Advisory shapes are bounded projections; their limits do not truncate compiler evidence. */
export function projectNativeSourceShape(graph: SourceTypeGraph): {
  shape: NativeSourceShape | null;
  notes: string[];
  requiredFieldDropped: boolean | null;
} {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const notes = new Set<string>();
  let visited = 0;
  let requiredFieldDropped = false;
  const visit = (id: string, required: boolean, depth: number, ancestors: Set<string>): NativeSourceShape | null => {
    const node = nodes.get(id);
    if (!node || node.coverage !== 'complete-within-declared-bound') return null;
    if (depth > graph.limits.maxDepth || ++visited > 2048) {
      notes.add('advisory-shape-budget');
      return null;
    }
    if (ancestors.has(id)) {
      notes.add('advisory-shape-cycle');
      return null;
    }
    const next = new Set(ancestors).add(id);
    let shape: NativeSourceShape | null = null;
    if (['string', 'number', 'boolean'].includes(node.kind))
      shape = { $type: node.kind as 'string' | 'number' | 'boolean', $required: required };
    else if (node.kind === 'reference')
      shape = node.alternatives?.length === 1 ? visit(node.alternatives[0]!, required, depth, next) : null;
    else if (node.kind === 'union') {
      const members = (node.alternatives ?? []).map((ref) => nodes.get(ref));
      const values = members.filter((member) => member && !['undefined', 'never'].includes(member.kind));
      const shapes = values.map((member) => visit(member!.id, required, depth + 1, next));
      if (
        shapes.length &&
        shapes.every(
          (member) =>
            member && ['string', 'number', 'boolean'].includes(member.$type) && member.$type === shapes[0]!.$type,
        )
      ) {
        shape = { ...shapes[0]!, $required: required };
        delete shape.$values;
      }
    } else if (node.kind === 'array' && node.items?.length === 1) {
      const item = visit(node.items[0]!, true, depth + 1, next);
      if (item) shape = { $type: 'array', $required: required, $items: item };
    } else if (['record', 'intersection'].includes(node.kind) && !node.indexSignatures?.length) {
      const fields: Record<string, NativeSourceShape> = Object.create(null);
      let complete = Boolean(node.fields?.length);
      for (const field of node.fields ?? []) {
        const child = visit(field.nodeId, field.required, depth + 1, next);
        if (child) {
          if (field.description) child.$description = field.description;
          fields[field.key] = child;
        } else {
          complete = false;
          if (field.required) requiredFieldDropped = true;
        }
      }
      if (complete) shape = { $type: 'record', $required: required, $fields: fields };
    }
    if (shape && closedChoices(node)) shape.$values = [...node.domain.declaredValues];
    return shape;
  };
  const root = nodes.get(graph.rootId);
  const shape = root ? visit(root.id, root.required, 0, new Set()) : null;
  return {
    shape,
    notes: [...notes],
    requiredFieldDropped: requiredFieldDropped
      ? true
      : shape && graph.coverage === 'complete-within-declared-bound'
        ? false
        : null,
  };
}

function closedChoices(node: SourceTypeNode): boolean {
  return (
    node.domain.provenance === 'compiler' &&
    node.domain.openness === 'closed' &&
    node.domain.declaredValues.length > 0 &&
    !(
      node.domain.declaredValues.length === 2 &&
      node.domain.declaredValues.includes(true) &&
      node.domain.declaredValues.includes(false)
    )
  );
}
