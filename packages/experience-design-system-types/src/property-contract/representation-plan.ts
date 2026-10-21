import type { CDFComponentEntry, CDFPropertyDefinition, CDFSlotDefinition } from '../cdf/types.js';
import { validateRepresentationProposal, type RepresentationProposalDraft } from './representation-proposal.js';
import { cdfToTarget } from '../cdf/property-validation.js';
import type { TargetDefinition } from './target-definition.js';
import { validateCDFProperty } from '../cdf/property-validation.js';
import {
  cloneJson,
  freezeJson,
  jsonEqual,
  jsonValueIssue,
  own,
  type JsonValue,
  type PropertyIssue,
} from './json-value.js';
import { contentDigest } from './content-digest.js';
import { propertyMapperBlockers } from './mapper-readiness.js';
import { prepareLogicalSourceGraph, type LogicalSourceGraph, type LogicalSourceNode } from './logical-source-graph.js';
import { nativeSourceRegion, sourceRecordFields } from './native-source-region.js';
import {
  LOCAL_NATIVE_PROPERTY_PROFILE,
  projectProperty,
  validateSourceGraph,
  validateSourceValue,
  type DefaultIntent,
  type MapperAvailability,
  type PropertyModel,
  type SourceGraphNode,
} from './property-model.js';

export interface ModelBinding {
  planId: string;
  componentId: string;
  propertyId: string;
  nodeId: string;
  sourceNodeId?: string;
}
export interface ModelCardinality {
  min: number;
  max: number | null;
  ordered: boolean;
  tuplePosition?: number;
  rest?: boolean;
}
export interface LogicalPhysicalMapping {
  nodeId: string;
  sourceNodeId: string;
  readonly: boolean;
  occurrenceReadonly: boolean;
  intrinsicReadonly: boolean;
  defaultIntent?: DefaultIntent;
  path: NonNullable<SourceGraphNode['path']>;
  required: boolean;
  nullable: boolean | null;
  undefinable: boolean | null;
  disposition: 'native-field' | 'model' | 'slot' | 'reference' | 'held';
  componentKey?: string;
  field?: string;
  slot?: string;
  targetNodeId?: string;
  reason?: string;
  withinValue?: { ownerNodeId: string; path: NonNullable<SourceGraphNode['path']> };
}
export interface RepresentationPlan {
  schemaVersion: 1;
  proposal?: RepresentationProposalDraft;
  id: string;
  kind: 'native' | 'component-model';
  identity: PropertyModel['identity'];
  sourceModel: PropertyModel;
  contextSnapshot?: JsonValue;
  logicalGraph: LogicalSourceGraph;
  sourceDigest: string;
  contextDigest: string;
  category: NonNullable<PropertyModel['category']>;
  defaultIntent: DefaultIntent;
  sourceDefault?: NonNullable<PropertyModel['source']['default']>;
  nativeDefinition?: CDFPropertyDefinition;
  models: Array<{ key: string; originalKey: string; nodeId: string; entry: CDFComponentEntry }>;
  attachment?: { slot: string; definition: CDFSlotDefinition };
  mappings: LogicalPhysicalMapping[];
  issues: PropertyIssue[];
  sdkValid: boolean;
  requirements: Array<{ path: string; capability: string }>;
}

function sourceDigest(model: PropertyModel): string {
  return contentDigest({ identity: model.identity, source: model.source });
}
function localContext(definition: CDFPropertyDefinition): Record<string, 'enabled'> {
  const result: Record<string, 'enabled'> = Object.create(null);
  const visit = (field: CDFPropertyDefinition | NonNullable<CDFPropertyDefinition['$items']>, path: string): void => {
    result[path + ':mapper'] = 'enabled';
    result[path + ':default'] = 'enabled';
    if (field.$items) visit(field.$items, path + '/items');
    if (field.valueType) visit(field.valueType as CDFPropertyDefinition, path + '/valueType');
    if (field.$fields)
      for (const [key, child] of Object.entries(field.$fields))
        visit(child, path + '/fields/' + key.replace(/~/g, '~0').replace(/\//g, '~1'));
  };
  visit(definition, '');
  return result;
}
export function deriveEditableRepresentationPlans(
  model: PropertyModel,
  options: {
    context?: JsonValue;
    modelEdits?: Readonly<Record<string, CDFComponentEntry>>;
    modelRenames?: Readonly<Record<string, string>>;
    defaultIntent?: DefaultIntent;
    proposal?: RepresentationProposalDraft;
  } = {},
): RepresentationPlan[] {
  if (
    model.identity.nodeId !== model.source.graph.rootId ||
    Object.values(model.identity).some((value) => typeof value !== 'string' || !value)
  )
    throw new Error('Representation source owner identity is incomplete or mismatched');
  const invalid = validateSourceGraph(model.source.graph);
  if (invalid.length) throw new Error(invalid.map((issue) => issue.message).join('; '));
  if (options.proposal) {
    const validation = validateRepresentationProposal(options.proposal, model, () => ({
      status: 'unknown',
      requirements: [{ path: '/', capability: 'source-reconstruction', availability: 'unknown' }],
    }));
    const desired = model.representation ?? model.source.shape;
    if (
      !validation.valid ||
      options.proposal.name !== model.identity.key ||
      !desired ||
      !jsonEqual(options.proposal.desiredDefinition, cdfToTarget(desired))
    )
      throw new Error('Proposal does not match the current source and desired definition context');
  }
  const sourceGraph = model.source.graph;
  const graph = prepareLogicalSourceGraph(model);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const root = nodes.get(graph.rootId)!;
  const category = model.category ?? 'content';
  const intent = cloneJson(options.defaultIntent ?? model.defaultIntent);
  const defaultIssues = intent.action === 'set' ? validateSourceValue(sourceGraph, intent.value) : [];
  const base = {
    schemaVersion: 1 as const,
    identity: cloneJson(model.identity),
    sourceModel: cloneJson(model),
    ...(options.context === undefined ? {} : { contextSnapshot: cloneJson(options.context) }),
    logicalGraph: cloneJson(graph),
    sourceDigest: sourceDigest(model),
    contextDigest: contentDigest(options.context ?? LOCAL_NATIVE_PROPERTY_PROFILE),
    category,
    defaultIntent: intent,
    ...(options.proposal ? { proposal: cloneJson(options.proposal) } : {}),
    ...(model.source.default ? { sourceDefault: cloneJson(model.source.default) } : {}),
  };
  const finish = (input: Omit<RepresentationPlan, 'id'>): RepresentationPlan => {
    const plan = cloneJson(input) as RepresentationPlan;
    plan.id = contentDigest(input);
    for (const generated of plan.models) {
      generated.entry.$model = {
        planId: plan.id,
        componentId: model.identity.componentId,
        propertyId: model.identity.propertyId,
        nodeId: generated.nodeId,
        sourceNodeId: nodes.get(generated.nodeId)!.sourceNodeId,
      };
      for (const slot of Object.values(generated.entry.$slots ?? {}))
        if (slot.$modelBinding) slot.$modelBinding.planId = plan.id;
    }
    if (plan.attachment?.definition.$modelBinding) plan.attachment.definition.$modelBinding.planId = plan.id;
    return freezeJson(cloneJson(plan));
  };
  const plans: RepresentationPlan[] = [];
  const mappingFacts = (node: LogicalSourceNode) => ({
    nodeId: node.id,
    sourceNodeId: node.sourceNodeId,
    path: cloneJson(node.path),
    required: node.required,
    readonly: node.readonly,
    occurrenceReadonly: node.occurrenceReadonly,
    intrinsicReadonly: node.intrinsicReadonly,
    nullable: node.nullable ?? null,
    undefinable: node.undefinable ?? null,
    ...(node.defaultIntent ? { defaultIntent: cloneJson(node.defaultIntent) } : {}),
  });
  const emptyValueRequirements = graph.nodes
    .filter((node) => node.kind === 'record' && !node.fields?.length && !node.indexSignatures?.length)
    .map((node) => ({ path: '/source/' + node.id, capability: 'empty-source-value-materialization' }));
  const valueStateRequirements = graph.nodes
    .filter(
      (node) =>
        node.nullable ||
        node.undefinable ||
        ['null', 'undefined'].includes(node.kind) ||
        node.nullability?.null.state === 'unknown' ||
        node.nullability?.undefined.state === 'unknown',
    )
    .map((node) => ({ path: '/source/' + node.id, capability: 'presence-null-state' }));
  const derived = nativeSourceRegion(root.id, nodes);
  const original = model.representation;
  const ordinary = original && ['string', 'number', 'boolean', 'record', 'array'].includes(original.$type);
  const rawNative = !original || ordinary ? (derived ? { ...(original ?? {}), ...derived } : original) : original;
  const native: CDFPropertyDefinition | undefined = rawNative
    ? { ...cloneJson(rawNative), $category: category }
    : undefined;
  if (native) {
    const candidate = { ...model, representation: native, defaultIntent: intent };
    const projection = projectProperty(candidate, LOCAL_NATIVE_PROPERTY_PROFILE, {
      capabilities: localContext(native),
    });
    if (projection.outcome !== 'unsupported' && projection.target) {
      const applyDefaults = (
        field: CDFPropertyDefinition | NonNullable<CDFPropertyDefinition['$items']>,
        target: TargetDefinition,
      ): void => {
        if (own(target, 'defaultValue')) field.$default = cloneJson(target.defaultValue!);
        else delete field.$default;
        if (field.$items && target.items) applyDefaults(field.$items, target.items);
        if (field.$fields && target.fields)
          for (const [key, child] of Object.entries(field.$fields)) applyDefaults(child, target.fields[key]!);
      };
      if (projection.target) applyDefaults(native, projection.target);
      plans.push(
        finish({
          ...base,
          kind: 'native',
          nativeDefinition: cloneJson(native),
          models: [],
          mappings: graph.nodes.map((node) => ({
            ...mappingFacts(node),
            disposition: 'native-field' as const,
            field: model.identity.key,
            withinValue: {
              ownerNodeId: root.id,
              path: cloneJson(
                node.path
                  .slice(root.path.length)
                  .filter((segment) => !['union', 'intersection'].includes(segment.kind)),
              ),
            },
            ...(node.kind === 'reference' ? { targetNodeId: node.alternatives?.[0] } : {}),
          })),
          issues: defaultIssues,
          sdkValid: !defaultIssues.length && graph.coverage === 'complete-within-declared-bound',
          requirements: [
            ...valueStateRequirements,
            ...emptyValueRequirements,
            ...(projection.outcome === 'conditional'
              ? projection.requirements
                  .filter((requirement) => requirement.availability !== 'enabled')
                  .map(({ path, capability }) => ({ path, capability }))
              : []),
            ...propertyMapperBlockers(native).map((path) => ({ path, capability: 'deployed-mapper' })),
            ...(['RichText', 'JSON', 'ResourceLink'].includes(native.$type) && model.source.default
              ? [{ path: '/', capability: 'source-default-materialization' }]
              : []),
            ...(model.representationProposal?.compatibility?.unresolvedRequirements ?? []).map((capability) => ({
              path: '/',
              capability,
            })),
          ],
        }),
      );
    }
  }
  const mappings = new Map<string, LogicalPhysicalMapping>();
  const models = new Map<string, { key: string; nodeId: string; entry: CDFComponentEntry }>();
  const issues: PropertyIssue[] = [...defaultIssues];
  const requirements: RepresentationPlan['requirements'] = [
    { path: '/', capability: 'source-reconstruction' },
    { path: '/', capability: 'component-model-mapper' },
  ];
  if (intent.action === 'absent' && model.source.default?.state === 'unsupported')
    requirements.push({ path: '/', capability: 'source-default-evaluation' });
  const bound = (
    node: LogicalSourceNode,
    disposition: LogicalPhysicalMapping['disposition'],
    extra: Partial<LogicalPhysicalMapping> = {},
  ): void => {
    if (!mappings.has(node.id))
      mappings.set(node.id, {
        ...mappingFacts(node),
        disposition,
        ...extra,
      });
  };
  requirements.push(...valueStateRequirements, ...emptyValueRequirements);
  if (graph.nodes.some((node) => node.defaultIntent))
    requirements.push({ path: '/', capability: 'source-structural-default-materialization' });
  const binding = (nodeId: string): ModelBinding => ({
    planId: '',
    componentId: model.identity.componentId,
    propertyId: model.identity.propertyId,
    nodeId,
    sourceNodeId: nodes.get(nodeId)!.sourceNodeId,
  });
  const generatedKey = (node: LogicalSourceNode) =>
    'Model_' + contentDigest({ owner: model.identity, nodeId: node.id }).slice(0, 32);
  const hold = (node: LogicalSourceNode, reason: string): void => {
    mappings.delete(node.id);
    bound(node, 'held', { reason });
    issues.push({ path: '/source/' + node.id, message: reason });
  };
  const activeModels = new Set<string>();
  const nativeMapping = (id: string, componentKey: string, field: string, ownerId = id): void => {
    const pending = [id];
    const visited = new Set<string>();
    const owner = nodes.get(ownerId)!;
    while (pending.length) {
      const current = nodes.get(pending.pop()!)!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      bound(current, 'native-field', {
        componentKey,
        field,
        withinValue: {
          ownerNodeId: ownerId,
          path: cloneJson(
            current.path
              .slice(owner.path.length)
              .filter((segment) => !['union', 'intersection'].includes(segment.kind)),
          ),
        },
        ...(current.kind === 'reference' ? { targetNodeId: current.alternatives?.[0] } : {}),
      });
      if (current.kind === 'reference') continue;
      pending.push(
        ...(current.fields?.map((item) => item.nodeId) ?? []),
        ...(current.items ?? []),
        ...(current.alternatives ?? []),
      );
    }
  };
  const nativeProperty = (id: string): CDFPropertyDefinition | undefined => {
    const field = nativeSourceRegion(id, nodes);
    return field ? { ...field, $category: category === 'unattached' ? 'content' : category } : undefined;
  };
  const modelFor = (id: string): string | undefined => {
    const node = nodes.get(id)!;
    if (node.kind === 'reference') {
      const target = node.alternatives?.[0];
      if (!target || activeModels.has(target)) {
        hold(node, 'Recursive source retained; cyclic physical model dependencies are unavailable');
        requirements.push({ path: '/source/' + id, capability: 'cyclic-model-dependencies' });
        return;
      }
      bound(node, 'reference', { targetNodeId: target });
      return modelFor(target);
    }
    const key = generatedKey(node);
    if (activeModels.has(id)) {
      hold(node, 'Recursive source retained; cyclic physical model dependencies are unavailable');
      return;
    }
    if (models.has(key)) return key;
    const entry: CDFComponentEntry = {
      $type: 'component',
      $properties: Object.create(null),
      $slots: Object.create(null),
    };
    models.set(key, { key, nodeId: id, entry });
    activeModels.add(id);
    bound(node, 'model', { componentKey: key });
    const addSlot = (name: string, target: LogicalSourceNode, cardinality: ModelCardinality): void => {
      const targetKey = modelFor(target.id);
      if (!targetKey) return;
      entry.$slots![name] = {
        $required: cardinality.min > 0,
        $allowedComponents: [targetKey],
        $cardinality: cardinality,
        $modelBinding: binding(target.id),
      };
      requirements.push({
        path: '/' + key + '/$slots/' + name,
        capability: cardinality.ordered ? 'ordered-slot-cardinality' : 'singleton-slot-cardinality',
      });
    };
    const fields = sourceRecordFields(node, nodes);
    if (fields) {
      for (const field of fields) {
        const child = nodes.get(field.nodeId)!;
        const definition = nativeProperty(child.id);
        if (definition) {
          definition.$required = field.required;
          if (field.description) definition.$description = field.description;
          entry.$properties[field.key] = definition;
          nativeMapping(child.id, key, field.key);
        } else addSlot(field.key, child, { min: field.required ? 1 : 0, max: 1, ordered: false });
      }
      for (const [index, signature] of (node.indexSignatures ?? []).entries()) {
        const child = nodes.get(signature.valueNodeId)!;
        const targetKey = modelFor(child.id);
        if (!targetKey) continue;
        const itemKey = 'Model_' + contentDigest({ owner: model.identity, nodeId: node.id, index }).slice(0, 32);
        models.set(itemKey, {
          key: itemKey,
          nodeId: id,
          entry: {
            $type: 'component',
            $properties: {
              key: {
                $type: signature.keyType === 'number' ? 'number' : 'string',
                $category: 'content',
                $required: true,
              },
            },
            $slots: {
              value: {
                $required: true,
                $allowedComponents: [targetKey],
                $cardinality: { min: 1, max: 1, ordered: false },
                $modelBinding: binding(child.id),
              },
            },
          },
        });
        entry.$slots!['index_' + index] = {
          $required: false,
          $allowedComponents: [itemKey],
          $cardinality: { min: 0, max: null, ordered: true },
          $modelBinding: binding(node.id),
        };
        requirements.push({ path: '/' + key, capability: 'index-key-preservation:' + signature.keyType });
      }
      if (node.kind === 'intersection') {
        const pending = [...(node.alternatives ?? [])];
        const visited = new Set<string>();
        while (pending.length) {
          const member = nodes.get(pending.pop()!)!;
          if (visited.has(member.id)) continue;
          visited.add(member.id);
          bound(member, 'reference', {
            targetNodeId: node.id,
            reason: 'Disjoint compiler record members retained in the merged region',
          });
          for (const field of member.fields ?? []) {
            const target = fields.find((candidate) => candidate.key === field.key);
            if (target) {
              bound(nodes.get(field.nodeId)!, 'reference', { targetNodeId: target.nodeId });
              const descendants = [{ source: field.nodeId, target: target.nodeId }];
              const reached = new Set<string>();
              while (descendants.length) {
                const pair = descendants.pop()!;
                const child = nodes.get(pair.source)!;
                const destination = nodes.get(pair.target)!;
                if (reached.has(child.id)) continue;
                reached.add(child.id);
                if (
                  child.sourceNodeId !== destination.sourceNodeId &&
                  (!child.compilerIdentity || child.compilerIdentity.typeId !== destination.compilerIdentity?.typeId)
                ) {
                  hold(child, 'Intersection field has no exact compiler association with the merged field');
                  continue;
                }
                bound(child, 'reference', { targetNodeId: destination.id });
                if (child.kind === 'reference') continue;
                for (const edge of child.fields ?? []) {
                  const other = destination.fields?.find((candidate) => candidate.key === edge.key);
                  if (other) descendants.push({ source: edge.nodeId, target: other.nodeId });
                }
                for (const edge of ['items', 'alternatives'] as const)
                  (child[edge] ?? []).forEach((source, index) => {
                    const target = destination[edge]?.[index];
                    if (target) descendants.push({ source, target });
                  });
              }
            }
          }
          pending.push(...(member.alternatives ?? []));
        }
      }
    } else if (node.kind === 'array' && node.items?.length === 1) {
      const definition = nativeProperty(id);
      if (definition) {
        entry.$properties.value = definition;
        mappings.delete(id);
        nativeMapping(id, key, 'value');
      } else addSlot('items', nodes.get(node.items[0]!)!, { min: 0, max: null, ordered: true });
    } else if (node.kind === 'tuple') {
      (node.items ?? []).forEach((item, index) => {
        const element = node.tupleElements?.[index];
        addSlot('position_' + index, nodes.get(item)!, {
          min: element?.optional || element?.rest ? 0 : 1,
          max: element?.rest ? null : 1,
          ordered: true,
          tuplePosition: index,
          rest: element?.rest ?? false,
        });
      });
    } else if (node.kind === 'union') {
      const members = (node.alternatives ?? []).map((alternative) => nodes.get(alternative)!);
      const values = members.filter((member) => !['null', 'undefined', 'never'].includes(member.kind));
      const definition = nativeProperty(id);
      if (definition) {
        entry.$properties.value = definition;
        mappings.delete(id);
        nativeMapping(id, key, 'value');
      } else if (values.length === 1) {
        for (const absent of members.filter((member) => member !== values[0]))
          bound(absent, 'slot', { componentKey: key, slot: 'presence' });
        addSlot('value', values[0]!, { min: 1, max: 1, ordered: false });
        requirements.push({ path: '/source/' + id, capability: 'presence-null-state' });
      } else hold(node, 'Compiler union retained; no proven editable variant representation');
    } else {
      const definition = nativeProperty(id);
      if (definition) {
        entry.$properties.value = definition;
        mappings.delete(id);
        nativeMapping(id, key, 'value');
      } else hold(node, 'Source kind has no proven editable field representation');
    }
    activeModels.delete(id);
    return key;
  };
  const rootKey = modelFor(root.id);
  for (const node of graph.nodes) if (!mappings.has(node.id)) hold(node, 'Logical source node has no physical mapping');
  if (graph.coverage !== 'complete-within-declared-bound')
    issues.push({ path: '/source', message: 'Source coverage remains bounded or incomplete' });
  for (const generated of models.values()) {
    const edit =
      options.modelEdits && own(options.modelEdits, generated.key) ? options.modelEdits[generated.key] : undefined;
    if (!edit) continue;
    if (
      jsonValueIssue(edit) ||
      edit.$type !== 'component' ||
      !jsonEqual(Object.keys(edit.$properties).sort(), Object.keys(generated.entry.$properties).sort()) ||
      !jsonEqual(edit.$slots ?? {}, generated.entry.$slots ?? {})
    )
      throw new Error('Edited model changes source-owned structure');
    for (const [field, edited] of Object.entries(edit.$properties)) {
      const original = generated.entry.$properties[field]!;
      const structural = cloneJson(edited);
      delete structural.$description;
      delete structural.$default;
      const originalStructural = cloneJson(original);
      delete originalStructural.$description;
      delete originalStructural.$default;
      if (!jsonEqual(structural, originalStructural) || !validateCDFProperty(edited).valid)
        throw new Error('Edited model field violates source type or requiredness');
      const mapped = [...mappings.values()].find(
        (mapping) => mapping.componentKey === generated.key && mapping.field === field,
      );
      const node = mapped ? nodes.get(mapped.nodeId)! : nodes.get(generated.nodeId)!;
      if (
        own(edited, '$default') &&
        validateSourceValue(sourceGraph, edited.$default!, '/defaultValue', node.sourceNodeId).length
      )
        throw new Error('Edited model default violates source structure');
      if (
        own(edited, '$default') &&
        node.domain.openness === 'closed' &&
        node.domain.declaredValues.length &&
        !node.domain.declaredValues.some((value) => jsonEqual(value, edited.$default))
      )
        throw new Error('Edited model default violates source domain');
      generated.entry.$properties[field] = cloneJson(edited);
    }
    if (edit.$description !== undefined) generated.entry.$description = edit.$description;
  }
  if (options.modelEdits && Object.keys(options.modelEdits).some((key) => !models.has(key)))
    throw new Error('Edited model has no exact source owner');
  const renamedKeys = new Map<string, string>();
  const reservedKeys = new Set<string>();
  for (const generated of models.values()) {
    const name =
      options.modelRenames && own(options.modelRenames, generated.key)
        ? options.modelRenames[generated.key]!
        : generated.key;
    if (
      typeof name !== 'string' ||
      !name.trim() ||
      name !== name.trim() ||
      name.split('.').some((segment) => !segment || segment.startsWith('$')) ||
      reservedKeys.has(name)
    )
      throw new Error('Edited model identity is invalid or duplicated');
    renamedKeys.set(generated.key, name);
    reservedKeys.add(name);
  }
  if (options.modelRenames && Object.keys(options.modelRenames).some((key) => !models.has(key)))
    throw new Error('Edited model identity has no exact source owner');
  const renamedModels = [...models.values()].map((generated) => {
    const entry = cloneJson(generated.entry);
    for (const slot of Object.values(entry.$slots ?? {}))
      if (slot.$allowedComponents)
        slot.$allowedComponents = slot.$allowedComponents.map((key) => renamedKeys.get(key)!);
    return { ...generated, originalKey: generated.key, key: renamedKeys.get(generated.key)!, entry };
  });
  for (const mapping of mappings.values())
    if (mapping.componentKey) mapping.componentKey = renamedKeys.get(mapping.componentKey)!;
  const rebasedRequirements = requirements.map((requirement) => {
    for (const [original, renamed] of renamedKeys)
      if (requirement.path === '/' + original || requirement.path.startsWith('/' + original + '/'))
        return { ...requirement, path: '/' + renamed + requirement.path.slice(original.length + 1) };
    return requirement;
  });
  const uniqueRequirements = [
    ...new Map(rebasedRequirements.map((requirement) => [JSON.stringify(requirement), requirement])).values(),
  ];
  plans.push(
    finish({
      ...base,
      kind: 'component-model',
      models: renamedModels,
      attachment: {
        slot: model.identity.key,
        definition: {
          $required: root.required,
          ...(native?.$sourceInput ? { $sourceInput: cloneJson(native.$sourceInput) } : {}),
          $allowedComponents: rootKey ? [renamedKeys.get(rootKey)!] : [],
          $cardinality: { min: root.required ? 1 : 0, max: 1, ordered: false },
          $modelBinding: binding(root.id),
        },
      },
      mappings: graph.nodes.map((node) => mappings.get(node.id)!),
      issues,
      sdkValid: !issues.length,
      requirements: uniqueRequirements,
    }),
  );
  return plans;
}

export function validateRepresentationPlan(input: unknown, model: PropertyModel, context?: JsonValue): PropertyIssue[] {
  const unsafe = jsonValueIssue(input);
  if (unsafe || !input || typeof input !== 'object' || Array.isArray(input))
    return [unsafe ?? { path: '/', message: 'Expected representation plan' }];
  const plan = input as RepresentationPlan;
  try {
    if (
      !Array.isArray(plan.models) ||
      !Array.isArray(plan.mappings) ||
      !plan.defaultIntent ||
      !['native', 'component-model'].includes(plan.kind)
    )
      throw new Error('Malformed representation plan');
    const edits: Record<string, CDFComponentEntry> = Object.create(null);
    const renames: Record<string, string> = Object.create(null);
    const originalKeys = new Map(plan.models.map((generated) => [generated.key, generated.originalKey]));
    for (const generated of plan.models) {
      if (
        !generated ||
        typeof generated.key !== 'string' ||
        typeof generated.originalKey !== 'string' ||
        own(edits, generated.originalKey) ||
        originalKeys.size !== plan.models.length
      )
        throw new Error('Duplicate or invalid generated model identity');
      renames[generated.originalKey] = generated.key;
      edits[generated.originalKey] = cloneJson(generated.entry);
      delete edits[generated.originalKey]!.$model;
      for (const slot of Object.values(edits[generated.originalKey]!.$slots ?? {})) {
        if (slot.$modelBinding) slot.$modelBinding.planId = '';
        if (slot.$allowedComponents)
          slot.$allowedComponents = slot.$allowedComponents.map((key) => originalKeys.get(key) ?? key);
      }
    }
    const expected = deriveEditableRepresentationPlans(model, {
      context,
      modelEdits: edits,
      modelRenames: renames,
      defaultIntent: plan.defaultIntent,
      ...(plan.proposal ? { proposal: plan.proposal } : {}),
    }).find((candidate) => candidate.kind === plan.kind);
    if (!expected || !jsonEqual(expected, plan))
      throw new Error('Stale, forged or incompatible source representation plan');
    if (!plan.sdkValid)
      return plan.issues.length
        ? cloneJson(plan.issues)
        : [{ path: '/', message: 'Plan has held logical source nodes' }];
    return [];
  } catch (error) {
    return [{ path: '/', message: error instanceof Error ? error.message : 'Invalid representation plan' }];
  }
}

export function evaluateRepresentationReadiness(
  plan: RepresentationPlan,
  capabilities: Readonly<Record<string, MapperAvailability>> = {},
): {
  ready: boolean;
  requirements: ReadonlyArray<{ path: string; capability: string; availability: MapperAvailability }>;
} {
  const requirements = plan.requirements.map((requirement) => ({
    ...requirement,
    availability: own(capabilities, requirement.path + ':' + requirement.capability)
      ? capabilities[requirement.path + ':' + requirement.capability]!
      : ('unknown' as const),
  }));
  return {
    ready: plan.sdkValid && requirements.every((requirement) => requirement.availability === 'enabled'),
    requirements: freezeJson(cloneJson(requirements)),
  };
}
