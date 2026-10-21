import { contentDigest } from './content-digest.js';
import { cloneJson, own } from './json-value.js';
import {
  validateSourceGraph,
  type DefaultIntent,
  type PropertyModel,
  type SourceGraphDeclaration,
  type SourceGraphNode,
} from './property-model.js';

export interface LogicalSourceNode extends SourceGraphNode {
  sourceNodeId: string;
  path: NonNullable<SourceGraphNode['path']>;
  readonly: boolean;
  occurrenceReadonly: boolean;
  intrinsicReadonly: boolean;
  defaultIntent?: DefaultIntent;
}
export interface LogicalSourceGraph {
  authority: 'compiler';
  rootId: string;
  nodes: LogicalSourceNode[];
  coverage: PropertyModel['source']['graph']['coverage'];
}

/** Only own record fields identify a default; an array sample cannot establish item defaults. */
export function sourceDefaultAtPath(
  model: Pick<PropertyModel, 'source'>,
  path: LogicalSourceNode['path'],
): DefaultIntent | undefined {
  if (model.source.default?.state !== 'value' || !own(model.source.default, 'value')) return;
  let value = model.source.default.value!;
  for (const segment of path) {
    if (segment.kind === 'union' || segment.kind === 'intersection') continue;
    if (
      segment.kind !== 'field' ||
      typeof segment.key !== 'string' ||
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      !own(value, segment.key)
    )
      return;
    value = value[segment.key]!;
  }
  return { action: 'set', value: cloneJson(value) };
}

/** Expand each compiler node once and retain shared occurrences as explicit logical references. */
export function prepareLogicalSourceGraph(model: Pick<PropertyModel, 'identity' | 'source'>): LogicalSourceGraph {
  const source = model.source.graph;
  const invalid = validateSourceGraph(source);
  if (invalid.length) throw new Error(invalid.map((issue) => issue.message).join('; '));
  if (
    model.identity.nodeId !== source.rootId ||
    Object.values(model.identity).some((value) => typeof value !== 'string' || !value)
  )
    throw new Error('Logical source root owner is incomplete or mismatched');
  const byId = new Map(source.nodes.map((node) => [node.id, node]));
  const intrinsicReadonly = (id: string): boolean => {
    const seen = new Set<string>();
    let current = byId.get(id);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.readonly === true) return true;
      if (current.kind === 'reference' && current.alternatives?.length === 1) {
        current = byId.get(current.alternatives[0]!);
      } else if (current.kind === 'union') {
        const values = (current.alternatives ?? [])
          .map((child) => byId.get(child)!)
          .filter((child) => !['null', 'undefined', 'never'].includes(child.kind));
        if (values.length !== 1) return false;
        current = values[0];
      } else return false;
    }
    return false;
  };
  const nodes: LogicalSourceNode[] = [];
  const canonical = new Map<string, string>();
  const root = byId.get(source.rootId)!;
  const rootPath = root.path ?? root.keyPath.map((key) => ({ kind: 'field' as const, key }));
  type Request = {
    sourceId: string;
    path: LogicalSourceNode['path'];
    required: boolean;
    readonly: boolean;
    declarations?: SourceGraphDeclaration[];
    target?: boolean;
  };
  const visit = function* (request: Request): Generator<Request, string, string> {
    const original = byId.get(request.sourceId)!;
    const known = canonical.get(original.id);
    if (known && request.target) return known;
    const id = known
      ? 'occurrence_' +
        contentDigest({ owner: model.identity, sourceNodeId: original.id, path: request.path }).slice(0, 32)
      : original.id;
    const node: LogicalSourceNode = {
      ...cloneJson(original),
      id,
      sourceNodeId: original.id,
      path: cloneJson(request.path),
      required: request.required,
      readonly: request.readonly || intrinsicReadonly(original.id),
      occurrenceReadonly: request.readonly,
      intrinsicReadonly: intrinsicReadonly(original.id),
      ...(request.declarations ? { declarations: cloneJson(request.declarations) } : {}),
    };
    const intent = sourceDefaultAtPath(model, request.path.slice(rootPath.length));
    if (intent) node.defaultIntent = intent;
    nodes.push(node);
    if (known) {
      node.kind = 'reference';
      node.reason = 'shared-source-occurrence';
      node.alternatives = [known];
      delete node.fields;
      delete node.items;
      delete node.indexSignatures;
      delete node.tupleElements;
      return id;
    }
    canonical.set(original.id, id);
    const child = (
      sourceId: string,
      kind: LogicalSourceNode['path'][number]['kind'],
      key: string | number,
      required = request.required,
      readonly = false,
      declarations?: SourceGraphDeclaration[],
    ): Request => ({
      sourceId,
      path: [...request.path, { kind, key }],
      required,
      readonly,
      ...(declarations ? { declarations } : {}),
    });
    if (original.fields) {
      node.fields = [];
      for (const field of original.fields) {
        const nodeId = yield child(
          field.nodeId,
          'field',
          field.key,
          field.required,
          field.readonly ?? false,
          field.declarations,
        );
        node.fields.push({ ...cloneJson(field), nodeId, path: [...request.path, { kind: 'field', key: field.key }] });
      }
    }
    if (original.items) {
      node.items = [];
      node.tupleElements = original.tupleElements ? [] : undefined;
      if (!original.tupleElements) delete node.tupleElements;
      for (const [index, sourceId] of original.items.entries()) {
        const tuple = original.tupleElements?.[index];
        const nodeId = yield child(
          sourceId,
          original.kind === 'tuple' ? 'tuple' : 'item',
          index,
          tuple ? !tuple.optional : true,
        );
        node.items.push(nodeId);
        if (tuple) node.tupleElements!.push({ ...cloneJson(tuple), nodeId });
      }
    }
    if (original.alternatives) {
      node.alternatives = [];
      for (const [index, sourceId] of original.alternatives.entries()) {
        const nodeId =
          original.kind === 'reference'
            ? yield {
                sourceId,
                path: request.path,
                required: request.required,
                readonly: request.readonly,
                target: true,
              }
            : yield child(sourceId, original.kind === 'intersection' ? 'intersection' : 'union', index);
        node.alternatives.push(nodeId);
      }
    }
    if (original.indexSignatures) {
      node.indexSignatures = [];
      for (const index of original.indexSignatures) {
        const valueNodeId = yield child(index.valueNodeId, 'index', index.keyType, false);
        node.indexSignatures.push({ ...cloneJson(index), valueNodeId });
      }
    }
    return id;
  };
  const frames = [
    visit({ sourceId: source.rootId, path: rootPath, required: root.required, readonly: root.readonly ?? false }),
  ];
  let returned = '';
  let rootId = '';
  while (frames.length) {
    const step = frames[frames.length - 1]!.next(returned);
    returned = '';
    if (step.done) {
      frames.pop();
      returned = step.value;
      if (!frames.length) rootId = returned;
    } else frames.push(visit(step.value));
  }
  if (canonical.size !== source.nodes.length) throw new Error('Logical compiler accounting is incomplete');
  return { authority: 'compiler', rootId, nodes, coverage: source.coverage };
}
