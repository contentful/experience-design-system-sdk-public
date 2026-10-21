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
import { isSourceBoundRepresentation } from './source-representation.js';
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
  sourceDigest: string;
  contextDigest: string;
  category: NonNullable<PropertyModel['category']>;
  defaultIntent: DefaultIntent;
  sourceDefault?: NonNullable<PropertyModel['source']['default']>;
  nativeDefinition?: CDFPropertyDefinition;
  models: Array<{ key: string; nodeId: string; entry: CDFComponentEntry }>;
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
function primitive(
  node: SourceGraphNode,
  nodes: Map<string, SourceGraphNode>,
  category: CDFPropertyDefinition['$category'],
): CDFPropertyDefinition | undefined {
  let kind = node.kind;
  if (kind === 'union') {
    const kinds = new Set(node.alternatives?.map((id) => nodes.get(id)?.kind));
    if (kinds.size === 1) kind = [...kinds][0]!;
  }
  if (!['string', 'number', 'boolean'].includes(kind) || node.domain.unrepresentedValues?.length) return;
  const definition: CDFPropertyDefinition = {
    $type: kind as 'string' | 'number' | 'boolean',
    $category: category,
    $required: node.required,
  };
  if (
    node.domain.openness === 'closed' &&
    node.domain.declaredValues.length &&
    !(
      kind === 'boolean' &&
      node.domain.declaredValues.length === 2 &&
      node.domain.declaredValues.includes(true) &&
      node.domain.declaredValues.includes(false)
    )
  )
    definition.$values = cloneJson(node.domain.declaredValues);
  return definition;
}

export function deriveEditableRepresentationPlans(
  model: PropertyModel,
  options: {
    context?: JsonValue;
    modelEdits?: Readonly<Record<string, CDFComponentEntry>>;
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
  const graph = model.source.graph;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const root = nodes.get(graph.rootId)!;
  const category = model.category ?? 'content';
  const intent = cloneJson(options.defaultIntent ?? model.defaultIntent);
  const defaultIssues = intent.action === 'set' ? validateSourceValue(graph, intent.value) : [];
  const base = {
    schemaVersion: 1 as const,
    identity: cloneJson(model.identity),
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
      };
      for (const slot of Object.values(generated.entry.$slots ?? {}))
        if (slot.$modelBinding) slot.$modelBinding.planId = plan.id;
    }
    if (plan.attachment?.definition.$modelBinding) plan.attachment.definition.$modelBinding.planId = plan.id;
    return cloneJson(plan);
  };
  const plans: RepresentationPlan[] = [];
  const rawNative = model.representation ?? model.source.shape;
  const native: CDFPropertyDefinition | undefined = rawNative
    ? { ...cloneJson(rawNative), $category: category }
    : undefined;
  if (native) {
    const candidate = { ...model, representation: native, defaultIntent: intent };
    const projection = projectProperty(candidate, LOCAL_NATIVE_PROPERTY_PROFILE, {
      capabilities: localContext(native),
    });
    if (projection.outcome === 'supported' || projection.outcome === 'lossy') {
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
            nodeId: node.id,
            path: cloneJson(node.path ?? node.keyPath.map((key) => ({ kind: 'field' as const, key }))),
            required: node.required,
            nullable: node.nullable ?? null,
            undefinable: node.undefinable ?? null,
            disposition: 'native-field' as const,
            field: model.identity.key,
            ...(isSourceBoundRepresentation(native.$type)
              ? {
                  withinValue: {
                    ownerNodeId: graph.rootId,
                    path: cloneJson(
                      (node.path ?? node.keyPath.map((key) => ({ kind: 'field' as const, key }))).slice(
                        (root.path ?? root.keyPath).length,
                      ),
                    ),
                  },
                }
              : {}),
          })),
          issues: defaultIssues,
          sdkValid: !defaultIssues.length && graph.coverage === 'complete-within-declared-bound',
          requirements: [
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
    node: SourceGraphNode,
    disposition: LogicalPhysicalMapping['disposition'],
    extra: Partial<LogicalPhysicalMapping> = {},
  ): void => {
    if (!mappings.has(node.id))
      mappings.set(node.id, {
        nodeId: node.id,
        path: cloneJson(node.path ?? node.keyPath.map((key) => ({ kind: 'field' as const, key }))),
        required: node.required,
        nullable: node.nullable ?? null,
        undefinable: node.undefinable ?? null,
        disposition,
        ...extra,
      });
  };
  for (const node of graph.nodes)
    if (node.nullable || node.undefinable || ['null', 'undefined'].includes(node.kind))
      requirements.push({ path: '/source/' + node.id, capability: 'presence-null-state' });
  const binding = (nodeId: string): ModelBinding => ({
    planId: '',
    componentId: model.identity.componentId,
    propertyId: model.identity.propertyId,
    nodeId,
  });
  const generatedKey = (node: SourceGraphNode) =>
    'Model_' + contentDigest({ owner: model.identity, nodeId: node.id }).slice(0, 32);
  const hold = (node: SourceGraphNode, reason: string): void => {
    mappings.delete(node.id);
    bound(node, 'held', { reason });
    issues.push({ path: '/source/' + node.id, message: reason });
  };
  const references = new Set<string>();
  const modelFor = (id: string): string => {
    const node = nodes.get(id)!;
    if (node.kind === 'reference') {
      if (references.has(id)) {
        const key = generatedKey(node);
        models.set(key, { key, nodeId: id, entry: { $type: 'component', $properties: Object.create(null) } });
        hold(node, 'Reference-only cycle has no editable value boundary');
        return key;
      }
      references.add(id);
      bound(node, 'reference', { targetNodeId: node.alternatives![0] });
      const key = modelFor(node.alternatives![0]!);
      references.delete(id);
      return key;
    }
    const key = generatedKey(node);
    if (models.has(key)) return key;
    const entry: CDFComponentEntry = {
      $type: 'component',
      $properties: Object.create(null),
      $slots: Object.create(null),
    };
    models.set(key, { key, nodeId: id, entry });
    bound(node, 'model', { componentKey: key });
    const addSlot = (name: string, target: SourceGraphNode, cardinality: ModelCardinality): void => {
      const targetKey = modelFor(target.id);
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
    if (node.kind === 'record' || node.kind === 'intersection') {
      for (const field of node.fields ?? []) {
        const child = nodes.get(field.nodeId)!;
        const definition = primitive(child, nodes, category === 'unattached' ? 'content' : category);
        if (definition) {
          definition.$required = field.required;
          entry.$properties[field.key] = definition;
          bound(child, 'native-field', { componentKey: key, field: field.key });
          for (const alternative of child.alternatives ?? [])
            bound(nodes.get(alternative)!, 'native-field', { componentKey: key, field: field.key });
        } else addSlot(field.key, child, { min: field.required ? 1 : 0, max: 1, ordered: false });
      }
      for (const [index, signature] of (node.indexSignatures ?? []).entries()) {
        const child = nodes.get(signature.valueNodeId)!;
        const itemKey = 'Model_' + contentDigest({ owner: model.identity, nodeId: node.id, index }).slice(0, 32);
        const targetKey = modelFor(child.id);
        models.set(itemKey, {
          key: itemKey,
          nodeId: node.id,
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
      for (const [index, alternative] of (node.alternatives ?? []).entries())
        addSlot('intersection_' + index, nodes.get(alternative)!, { min: 1, max: 1, ordered: false });
    } else if (node.kind === 'array') {
      addSlot('items', nodes.get(node.items![0]!)!, { min: 0, max: null, ordered: true });
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
      (node.alternatives ?? []).forEach((alternative, index) => {
        const child = nodes.get(alternative)!;
        if (['null', 'undefined', 'never'].includes(child.kind))
          bound(child, 'slot', { componentKey: key, slot: 'presence' });
        else addSlot('alternative_' + index, child, { min: 0, max: 1, ordered: false });
      });
      requirements.push({ path: '/' + key, capability: 'variant-selection' });
    } else {
      const definition = primitive(node, nodes, category === 'unattached' ? 'content' : category);
      if (definition) {
        entry.$properties.value = definition;
        mappings.delete(node.id);
        bound(node, 'native-field', { componentKey: key, field: 'value' });
      } else hold(node, 'Source kind has no proven editable field representation');
    }
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
  const uniqueRequirements = [
    ...new Map(requirements.map((requirement) => [JSON.stringify(requirement), requirement])).values(),
  ];
  plans.push(
    finish({
      ...base,
      kind: 'component-model',
      models: [...models.values()],
      attachment: {
        slot: model.identity.key,
        definition: {
          $required: root.required,
          ...(native?.$sourceInput ? { $sourceInput: cloneJson(native.$sourceInput) } : {}),
          $allowedComponents: [rootKey],
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
    for (const generated of plan.models) {
      if (!generated || typeof generated.key !== 'string' || own(edits, generated.key))
        throw new Error('Duplicate or invalid generated model identity');
      edits[generated.key] = cloneJson(generated.entry);
      delete edits[generated.key]!.$model;
      for (const slot of Object.values(edits[generated.key]!.$slots ?? {}))
        if (slot.$modelBinding) slot.$modelBinding.planId = '';
    }
    const expected = deriveEditableRepresentationPlans(model, {
      context,
      modelEdits: edits,
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
