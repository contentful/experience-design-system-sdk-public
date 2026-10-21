import type { CDFFieldDefinition } from '../cdf/types.js';
import { cdfToTarget } from '../cdf/property-validation.js';
import {
  childPath,
  cloneJson,
  freezeJson,
  jsonEqual,
  jsonValueIssue,
  own,
  type JsonValue,
  type PropertyIssue,
} from './json-value.js';
import {
  TARGET_PROPERTY_TYPES,
  validateTargetDefinition,
  validateTargetValue,
  type TargetDefinition,
  type TargetPropertyType,
} from './target-definition.js';
import { finiteSourceValueDomain, isSourceBoundRepresentation } from './source-representation.js';
import { validateRepresentationProposal, type RepresentationProposalDraft } from './representation-proposal.js';

export type MapperAvailability = 'enabled' | 'unavailable' | 'unknown';
export interface SourceGraphNode {
  id: string;
  path?: Array<{ kind: 'field' | 'item' | 'tuple' | 'union' | 'intersection' | 'index'; key: string | number }>;
  alias?: string;
  readonly?: boolean;
  nullable?: boolean;
  undefinable?: boolean;
  tupleElements?: Array<{ nodeId: string; label: string | null; optional: boolean; rest: boolean }>;
  discriminatorKeys?: string[];
  discriminator?: { provenance: 'compiler' | 'unknown'; complete: boolean; keys: string[] };
  nullabilityProvenance?: 'compiler' | 'syntax' | 'compiler-erased' | 'unknown';
  nullability?: {
    compilerMode: 'enabled' | 'disabled';
    null: { state: 'present' | 'absent' | 'unknown'; source: 'compiler' | 'syntax' | 'compiler-erased' | 'unknown' };
    undefined: {
      state: 'present' | 'absent' | 'unknown';
      source: 'compiler' | 'syntax' | 'compiler-erased' | 'unknown';
    };
  };
  callSignatures?: string[];
  keyPath: string[];
  kind: string;
  typeText: string;
  required: boolean;
  domain: {
    openness: 'closed' | 'open' | 'unknown';
    declaredValues: JsonValue[];
    provenance: 'compiler' | 'unknown';
    unrepresentedValues?: Array<{ typeText: string; reason: string }>;
  };
  fields?: Array<{ key: string; nodeId: string; required: boolean }>;
  items?: string[];
  alternatives?: string[];
  indexSignatures?: Array<{ keyType: string; valueNodeId: string }>;
  coverage: 'complete-within-declared-bound' | 'partial' | 'unavailable';
  reason: string | null;
}
export interface PropertySourceGraph {
  schemaVersion: 1;
  rootId: string;
  nodes: SourceGraphNode[];
  coverage: 'complete-within-declared-bound' | 'partial' | 'unavailable';
  limits: { maxDepth: number; maxNodes: number; maxFields: number };
  omittedCount: number;
}
export type DefaultIntent = { action: 'absent' } | { action: 'clear' } | { action: 'set'; value: JsonValue };
export interface PropertyModel {
  identity: { componentId: string; propertyId: string; key: string; sourceRevision: string; nodeId: string };
  source: {
    typeText: string;
    graph: PropertySourceGraph;
    shape: CDFFieldDefinition | null;
    default?: { expression: string; state?: 'value' | 'unsupported'; value?: JsonValue; reason?: string | null };
    observations: JsonValue[];
    useEvidence?: Array<{ reference: string; status: 'output-flow-found' | 'closed-absence' | 'unresolved' }>;
    originalFacts?: JsonValue;
  };
  category?: 'content' | 'design' | 'state' | 'unattached';
  representation?: CDFFieldDefinition;
  representationProposal?: RepresentationProposalDraft;
  defaultIntent: DefaultIntent;
  defaultAuthority?: 'generation' | 'review' | 'existing' | 'token';
}
export interface PropertyProfile {
  id: string;
  revision: 2;
  mapperTypes: string[];
  targetTypes: TargetPropertyType[];
  defaultSourceTypes: string[];
  defaultTargetTypes: TargetPropertyType[];
  requirements: Array<{ path: string; capability: string }>;
}
export interface ProjectionContext {
  capabilities: Record<string, MapperAvailability>;
}
export interface PropertyProjection {
  model: Readonly<PropertyModel>;
  profile: Readonly<PropertyProfile>;
  outcome: 'supported' | 'conditional' | 'lossy' | 'unsupported';
  target?: TargetDefinition;
  issues: PropertyIssue[];
  requirements: Array<{ path: string; capability: string; availability: MapperAvailability }>;
}
const DEFAULT_TARGETS: TargetPropertyType[] = [
  'String',
  'Number',
  'Boolean',
  'Array',
  'Record',
  'Integer',
  'DateTime',
  'Literal',
];
export function createPropertyProfile(profile: PropertyProfile): Readonly<PropertyProfile> {
  if (!profile || typeof profile.id !== 'string' || !profile.id || profile.revision !== 2)
    throw new Error('Profile requires identity and revision 2');
  if (
    !Array.isArray(profile.mapperTypes) ||
    !profile.mapperTypes.every((type) => typeof type === 'string') ||
    !Array.isArray(profile.targetTypes) ||
    !profile.targetTypes.every((type) => TARGET_PROPERTY_TYPES.includes(type)) ||
    !Array.isArray(profile.defaultSourceTypes) ||
    !Array.isArray(profile.defaultTargetTypes) ||
    !Array.isArray(profile.requirements) ||
    profile.requirements.some(
      (requirement) =>
        !requirement || typeof requirement.path !== 'string' || typeof requirement.capability !== 'string',
    )
  )
    throw new Error('Invalid mapper profile');
  if (profile.defaultTargetTypes.some((type) => !DEFAULT_TARGETS.includes(type)))
    throw new Error('Unsupported target default capability');
  if (
    new Set(profile.mapperTypes).size !== profile.mapperTypes.length ||
    profile.defaultSourceTypes.some((type) => !profile.mapperTypes.includes(type)) ||
    profile.defaultTargetTypes.some((type) => !profile.targetTypes.includes(type))
  )
    throw new Error('Inconsistent mapper capabilities');
  return freezeJson(cloneJson(profile));
}

export const LOCAL_NATIVE_PROPERTY_PROFILE = createPropertyProfile({
  id: 'local-native-cdf',
  revision: 2,
  mapperTypes: [
    'string',
    'number',
    'boolean',
    'array',
    'record',
    'richtext',
    'media',
    'link',
    'token',
    'Integer',
    'DateTime',
    'Literal',
    'RichText',
    'JSON',
    'ResourceLink',
  ],
  targetTypes: [...TARGET_PROPERTY_TYPES],
  defaultSourceTypes: [
    'string',
    'number',
    'boolean',
    'array',
    'record',
    'richtext',
    'token',
    'Integer',
    'DateTime',
    'Literal',
  ],
  defaultTargetTypes: DEFAULT_TARGETS,
  requirements: [],
});

export function validateSourceGraph(graph: PropertySourceGraph): PropertyIssue[] {
  const unsafe = jsonValueIssue(graph);
  if (unsafe) return [{ path: `/source/graph${unsafe.path}`, message: unsafe.message }];
  const issues: PropertyIssue[] = [];
  const add = (path: string, message: string): void => {
    issues.push({ path: `/source/graph${path}`, message });
  };
  if (
    !graph ||
    graph.schemaVersion !== 1 ||
    !Array.isArray(graph.nodes) ||
    !graph.limits ||
    !Number.isInteger(graph.limits.maxNodes) ||
    graph.limits.maxNodes < 1 ||
    graph.limits.maxNodes > 512 ||
    !Number.isInteger(graph.limits.maxDepth) ||
    graph.limits.maxDepth < 1 ||
    graph.limits.maxDepth > 16 ||
    !Number.isInteger(graph.limits.maxFields) ||
    graph.limits.maxFields < 1 ||
    graph.limits.maxFields > 2048 ||
    !Number.isInteger(graph.omittedCount) ||
    graph.omittedCount < 0 ||
    !['complete-within-declared-bound', 'partial', 'unavailable'].includes(graph.coverage)
  )
    return [{ path: '/source/graph', message: 'Invalid graph envelope or bounds' }];
  const ids = new Set(graph.nodes.map((node) => node?.id));
  if (graph.nodes.length > graph.limits.maxNodes || ids.size !== graph.nodes.length || !ids.has(graph.rootId))
    add('', 'Invalid graph identity or node bounds');
  let fieldCount = 0;
  for (const [i, node] of graph.nodes.entries()) {
    const path = `/nodes/${i}`;
    if (
      !node ||
      typeof node.id !== 'string' ||
      !node.id ||
      !Array.isArray(node.keyPath) ||
      !node.keyPath.every((key) => typeof key === 'string') ||
      ![
        'string',
        'number',
        'boolean',
        'null',
        'undefined',
        'never',
        'union',
        'intersection',
        'tuple',
        'array',
        'bigint',
        'symbol',
        'function',
        'record',
        'reference',
        'unknown',
      ].includes(node.kind) ||
      typeof node.typeText !== 'string' ||
      typeof node.required !== 'boolean' ||
      !['complete-within-declared-bound', 'partial', 'unavailable'].includes(node.coverage) ||
      (node.reason !== null && typeof node.reason !== 'string')
    ) {
      add(path, 'Invalid source node');
      continue;
    }
    if (
      !node.domain ||
      !['closed', 'open', 'unknown'].includes(node.domain.openness) ||
      !['compiler', 'unknown'].includes(node.domain.provenance) ||
      !Array.isArray(node.domain.declaredValues) ||
      (own(node.domain, 'unrepresentedValues') &&
        (!Array.isArray(node.domain.unrepresentedValues) ||
          !node.domain.unrepresentedValues.every(
            (value) => value && typeof value.typeText === 'string' && typeof value.reason === 'string',
          )))
    )
      add(`${path}/domain`, 'Invalid independent domain evidence');
    if (
      node.path !== undefined &&
      (!Array.isArray(node.path) ||
        node.path.length > graph.limits.maxDepth + 2 ||
        node.path.some(
          (part) =>
            !part ||
            !['field', 'item', 'tuple', 'union', 'intersection', 'index'].includes(part.kind) ||
            (typeof part.key !== 'string' &&
              (typeof part.key !== 'number' || !Number.isSafeInteger(part.key) || part.key < 0)),
        ))
    )
      add(`${path}/path`, 'Invalid typed source path');
    for (const key of ['readonly', 'nullable', 'undefinable'] as const)
      if (own(node, key) && typeof node[key] !== 'boolean') add(`${path}/${key}`, 'Invalid source metadata');
    if (node.alias !== undefined && (typeof node.alias !== 'string' || !node.alias))
      add(`${path}/alias`, 'Invalid source alias');
    for (const key of ['discriminatorKeys', 'callSignatures'] as const)
      if (
        node[key] !== undefined &&
        (!Array.isArray(node[key]) ||
          !node[key]!.every((value) => typeof value === 'string') ||
          new Set(node[key]).size !== node[key]!.length)
      )
        add(`${path}/${key}`, 'Invalid source metadata list');
    if (
      node.nullabilityProvenance !== undefined &&
      !['compiler', 'syntax', 'compiler-erased', 'unknown'].includes(node.nullabilityProvenance)
    )
      add(path, 'Invalid nullability provenance');
    if (node.nullability !== undefined) {
      const metadata = node.nullability;
      if (!metadata || !['enabled', 'disabled'].includes(metadata.compilerMode))
        add(`${path}/nullability`, 'Invalid null checking mode');
      for (const [kind, key] of [
        ['null', 'nullable'],
        ['undefined', 'undefinable'],
      ] as const) {
        const fact = metadata?.[kind];
        if (
          !fact ||
          !['present', 'absent', 'unknown'].includes(fact.state) ||
          !['compiler', 'syntax', 'compiler-erased', 'unknown'].includes(fact.source) ||
          (fact.state === 'present' && !['compiler', 'syntax'].includes(fact.source)) ||
          (fact.state === 'absent' && (fact.source !== 'compiler' || metadata.compilerMode !== 'enabled')) ||
          (fact.state === 'unknown' && !['compiler-erased', 'unknown'].includes(fact.source)) ||
          (fact.state === 'unknown' ? own(node, key) : node[key] !== (fact.state === 'present'))
        )
          add(`${path}/nullability/${kind}`, 'Invalid nullability fact');
      }
    }
    if (
      node.discriminator !== undefined &&
      (!node.discriminator ||
        !['compiler', 'unknown'].includes(node.discriminator.provenance) ||
        typeof node.discriminator.complete !== 'boolean' ||
        !Array.isArray(node.discriminator.keys) ||
        !jsonEqual(node.discriminator.keys, node.discriminatorKeys))
    )
      add(path, 'Invalid discriminator evidence');
    if (node.kind === 'reference' && node.alternatives?.length !== 1) add(path, 'Source reference requires one target');
    if (node.kind === 'array' && node.items?.length !== 1) add(path, 'Source array requires one item');
    if (
      node.tupleElements !== undefined &&
      (node.kind !== 'tuple' ||
        !Array.isArray(node.tupleElements) ||
        node.tupleElements.length !== node.items?.length ||
        node.tupleElements.filter((item) => item?.rest).length > 1 ||
        node.tupleElements.some(
          (item, index) =>
            !item ||
            item.nodeId !== node.items?.[index] ||
            (item.label !== null && typeof item.label !== 'string') ||
            typeof item.optional !== 'boolean' ||
            typeof item.rest !== 'boolean',
        ))
    )
      add(`${path}/tupleElements`, 'Invalid source tuple metadata');
    const refs: string[] = [];
    for (const key of ['items', 'alternatives'] as const)
      if (own(node, key)) {
        const list = node[key];
        if (!Array.isArray(list) || !list.every((id) => typeof id === 'string'))
          add(`${path}/${key}`, 'Invalid source references');
        else refs.push(...list);
      }
    if (own(node, 'fields')) {
      if (!Array.isArray(node.fields)) add(`${path}/fields`, 'Invalid source fields');
      else {
        fieldCount += node.fields.length;
        const keys = new Set<string>();
        for (const field of node.fields) {
          if (
            !field ||
            typeof field.key !== 'string' ||
            typeof field.nodeId !== 'string' ||
            typeof field.required !== 'boolean' ||
            keys.has(field.key)
          )
            add(`${path}/fields`, 'Invalid or duplicated own field');
          else {
            keys.add(field.key);
            refs.push(field.nodeId);
          }
        }
      }
    }
    if (own(node, 'indexSignatures')) {
      if (!Array.isArray(node.indexSignatures)) add(`${path}/indexSignatures`, 'Invalid index evidence');
      else
        for (const index of node.indexSignatures) {
          if (!index || typeof index.keyType !== 'string' || typeof index.valueNodeId !== 'string')
            add(`${path}/indexSignatures`, 'Invalid index reference');
          else refs.push(index.valueNodeId);
        }
    }
    for (const ref of refs) if (!ids.has(ref)) add(path, 'Invalid source node reference');
  }
  if (issues.length) return issues;
  for (const [i, node] of graph.nodes.entries()) {
    const path = `/nodes/${i}`;
    for (const field of node.fields ?? []) {
      const child = graph.nodes.find((item) => item.id === field.nodeId);
      if (child && field.required !== child.required) add(`${path}/fields`, 'Source edge requiredness disagrees');
      if (child?.path && node.path && !jsonEqual(child.path, [...node.path, { kind: 'field', key: field.key }]))
        add(`${path}/fields`, 'Source field path disagrees');
    }
    if (node.discriminator?.provenance === 'compiler' && node.discriminator.keys.length) {
      if (node.kind !== 'union' || !node.discriminator.complete) add(path, 'Discriminator requires complete union');
      for (const key of node.discriminator.keys) {
        const values: JsonValue[] = [];
        for (const alternative of node.alternatives ?? []) {
          const member = graph.nodes.find((item) => item.id === alternative);
          const edge = member?.fields?.find((field) => field.key === key);
          const tag = edge && graph.nodes.find((item) => item.id === edge.nodeId);
          if (
            !edge?.required ||
            !tag ||
            tag.domain.provenance !== 'compiler' ||
            tag.domain.openness !== 'closed' ||
            tag.domain.declaredValues.length !== 1 ||
            values.some((value) => jsonEqual(value, tag.domain.declaredValues[0]))
          )
            add(path, 'Unproven unique required discriminator');
          else values.push(tag.domain.declaredValues[0]!);
        }
      }
    }
  }
  const reachable = new Set<string>();
  const pending = [graph.rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const node = graph.nodes.find((item) => item.id === id);
    if (node)
      pending.push(
        ...(node.items ?? []),
        ...(node.alternatives ?? []),
        ...(node.fields?.map((field) => field.nodeId) ?? []),
        ...(node.indexSignatures?.map((index) => index.valueNodeId) ?? []),
      );
  }
  if (reachable.size !== graph.nodes.length) add('', 'Unreachable source nodes');
  if (fieldCount > graph.limits.maxFields) add('', 'Source field census exceeds bounds');
  if (
    graph.coverage === 'complete-within-declared-bound' &&
    (graph.omittedCount || graph.nodes.some((node) => node.coverage !== 'complete-within-declared-bound'))
  )
    add('', 'Complete coverage contradicts omitted or partial source evidence');
  return issues;
}

/** Validate JSON defaults against source structure independently of target support. */
export function validateSourceValue(
  graph: PropertySourceGraph,
  value: JsonValue,
  path = '/defaultValue',
): PropertyIssue[] {
  const invalid = validateSourceGraph(graph);
  if (invalid.length) return invalid;
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const visit = (
    id: string,
    current: JsonValue,
    at: string,
    ancestors: Map<string, Set<JsonValue>>,
  ): PropertyIssue[] => {
    const node = nodes.get(id)!;
    if (ancestors.get(id)?.has(current)) return [{ path: at, message: 'Nonconsuming recursive source' }];
    const next = new Map(ancestors);
    next.set(id, new Set([...(ancestors.get(id) ?? []), current]));
    const issue = (message: string): PropertyIssue[] => [{ path: at, message }];
    if (node.kind === 'reference')
      return node.alternatives?.length === 1
        ? visit(node.alternatives[0]!, current, at, next)
        : issue('Invalid source reference');
    if (node.kind === 'union') {
      const alternatives = (node.alternatives ?? []).map((ref) => visit(ref, current, at, next));
      return alternatives.some((result) => !result.length)
        ? []
        : issue('Default matches no declared source alternative');
    }
    if (node.kind === 'intersection') return (node.alternatives ?? []).flatMap((ref) => visit(ref, current, at, next));
    if (['string', 'number', 'boolean'].includes(node.kind) && typeof current !== node.kind)
      return issue('Default source kind mismatch');
    if (node.kind === 'null' && current !== null) return issue('Default source kind mismatch');
    if (['undefined', 'never'].includes(node.kind)) return issue('Source does not admit this JSON value');
    if (
      node.domain.provenance === 'compiler' &&
      node.domain.openness === 'closed' &&
      node.domain.declaredValues.length &&
      !node.domain.declaredValues.some((entry) => jsonEqual(entry, current))
    )
      return issue('Default outside proven source domain');
    if (node.kind === 'array') {
      if (!Array.isArray(current) || node.items?.length !== 1) return issue('Default source array mismatch');
      return current.flatMap((entry, index) => visit(node.items![0]!, entry, `${at}/${index}`, next));
    }
    if (node.kind === 'tuple') {
      if (!Array.isArray(current)) return issue('Default source tuple mismatch');
      const elements =
        node.tupleElements ?? (node.items ?? []).map((nodeId) => ({ nodeId, optional: false, rest: false }));
      const rest = elements.findIndex((element) => element.rest);
      if (rest < 0 && current.length > elements.length) return issue('Default tuple has extra items');
      const issues: PropertyIssue[] = [];
      const trailing = rest < 0 ? 0 : elements.length - rest - 1;
      if (rest >= 0 && current.length < rest + trailing) return issue('Required source tuple item missing');
      for (const [index, element] of elements.entries()) {
        if (element.rest) {
          for (let i = index; i < current.length - trailing; i++)
            issues.push(...visit(element.nodeId, current[i]!, `${at}/${i}`, next));
          continue;
        }
        const valueIndex = rest >= 0 && index > rest ? current.length - (elements.length - index) : index;
        if (valueIndex >= current.length) {
          if (!element.optional)
            issues.push({ path: `${at}/${valueIndex}`, message: 'Required source tuple item missing' });
        } else issues.push(...visit(element.nodeId, current[valueIndex]!, `${at}/${valueIndex}`, next));
      }
      return issues;
    }
    if (node.kind === 'record') {
      if (!current || typeof current !== 'object' || Array.isArray(current))
        return issue('Default source record mismatch');
      const issues: PropertyIssue[] = [];
      for (const field of node.fields ?? []) {
        if (!own(current, field.key)) {
          if (field.required) issues.push({ path: childPath(at, field.key), message: 'Required source field missing' });
        } else issues.push(...visit(field.nodeId, current[field.key]!, childPath(at, field.key), next));
      }
      for (const [key, entry] of Object.entries(current))
        for (const signature of node.indexSignatures ?? [])
          if (signature.keyType === 'string' || (signature.keyType === 'number' && String(Number(key)) === key))
            issues.push(...visit(signature.valueNodeId, entry, childPath(at, key), next));
      return issues;
    }
    if (!['string', 'number', 'boolean', 'null'].includes(node.kind))
      return issue('Source kind is not proven JSON data');
    return [];
  };
  return visit(graph.rootId, value, path, new Map());
}

/** Source domains remain independently proven; caller defaults and observations never close them. */
export function validateSourceDomain(graph: PropertySourceGraph, definition: TargetDefinition): PropertyIssue[] {
  const issues: PropertyIssue[] = [];
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const walk = (id: string, target: TargetDefinition, path: string, seen: Set<string>): void => {
    if (seen.has(id)) return;
    const node = nodes.get(id);
    if (!node) return;
    const next = new Set(seen);
    next.add(id);
    if (target.type === 'Literal' || target.type === 'Integer' || target.type === 'DateTime') {
      const values = finiteSourceValueDomain(graph, id);
      if (
        !values?.length ||
        values.some((value) => validateTargetValue(target, value).length) ||
        (target.type === 'Literal' && (values.length !== 1 || !jsonEqual(values[0], target.value)))
      )
        issues.push({ path, message: `${target.type} requires a proven compatible source domain` });
      if (target.required !== undefined && node.required !== target.required)
        issues.push({ path, message: 'Representation does not preserve source requiredness' });
      if (
        values?.length &&
        target.type !== 'Literal' &&
        (!target.values?.length ||
          values.some((value) => !target.values!.some((allowed) => jsonEqual(allowed, value))) ||
          target.values.some((allowed) => !values.some((value) => jsonEqual(allowed, value))))
      )
        issues.push({ path, message: 'Finite source domain is not enforced; source retained' });
      return;
    }
    if (node.kind === 'reference' || node.kind === 'union' || node.kind === 'intersection') {
      const memberTarget = { ...target };
      if (node.kind === 'union') delete memberTarget.defaultValue;
      for (const alternative of node.alternatives ?? []) {
        const member = nodes.get(alternative);
        if (member && !['undefined', 'never'].includes(member.kind)) walk(alternative, memberTarget, path, next);
      }
    }
    if (target.required !== undefined && node.required !== target.required)
      issues.push({ path, message: 'Representation does not preserve source requiredness' });
    if ((node.kind === 'array' && target.type !== 'Array') || (node.kind === 'record' && target.type !== 'Record'))
      issues.push({ path, message: 'Representation does not preserve source structure' });
    if (
      ['tuple', 'function', 'bigint', 'symbol', 'unknown'].includes(node.kind) ||
      node.indexSignatures?.length ||
      node.kind === 'reference'
    )
      issues.push({ path, message: 'Native source structure unavailable; source retained' });
    if (
      ['string', 'number', 'boolean', 'null'].includes(node.kind) &&
      ({ string: 'String', number: 'Number', boolean: 'Boolean', null: 'JSON' } as Record<string, string>)[
        node.kind
      ] !== target.type
    )
      issues.push({ path, message: 'Representation does not preserve source kind' });
    if (node.domain.openness === 'open' && target.values?.length)
      issues.push({ path, message: 'Representation narrows open source domain' });
    if (node.domain.unrepresentedValues?.length)
      issues.push({ path: `${path}/sourceDomain`, message: 'Source domain contains unrepresentable values' });
    if (
      node.domain.provenance === 'compiler' &&
      node.domain.openness === 'closed' &&
      node.domain.declaredValues.length
    ) {
      node.domain.declaredValues.forEach((value, i) =>
        issues.push(...validateTargetValue(target, value, `${path}/sourceDomain/${i}`)),
      );
      if (own(target, 'defaultValue') && !node.domain.declaredValues.some((v) => jsonEqual(v, target.defaultValue)))
        issues.push({ path: `${path}/defaultValue`, message: 'Default outside proven source domain' });
    }
    if (target.type === 'Record')
      for (const field of node.fields ?? []) {
        if (!own(target.fields!, field.key)) {
          issues.push({
            path: childPath(childPath(path, 'fields'), field.key),
            message: 'Source field missing from representation',
          });
          continue;
        }
        walk(field.nodeId, target.fields![field.key]!, childPath(childPath(path, 'fields'), field.key), next);
      }
    if (target.type === 'Array' && node.items?.length === 1) walk(node.items[0]!, target.items!, `${path}/items`, next);
  };
  walk(graph.rootId, definition, '', new Set());
  if (own(definition, 'defaultValue')) issues.push(...validateSourceValue(graph, definition.defaultValue!));
  const defaultDomain = (id: string, value: JsonValue, path: string, seen: Set<string>): void => {
    if (seen.has(id)) return;
    const node = nodes.get(id);
    if (!node) return;
    const next = new Set(seen);
    next.add(id);
    if (
      node.domain.provenance === 'compiler' &&
      node.domain.openness === 'closed' &&
      node.domain.declaredValues.length &&
      !node.domain.declaredValues.some((allowed) => jsonEqual(allowed, value))
    )
      issues.push({ path, message: 'Default outside proven source domain' });
    if (node.kind === 'array' && Array.isArray(value) && node.items?.length === 1)
      value.forEach((item, i) => defaultDomain(node.items![0]!, item, `${path}/${i}`, next));
    if (value && typeof value === 'object' && !Array.isArray(value))
      for (const field of node.fields ?? [])
        if (own(value, field.key)) defaultDomain(field.nodeId, value[field.key]!, childPath(path, field.key), next);
  };
  if (own(definition, 'defaultValue'))
    defaultDomain(graph.rootId, definition.defaultValue!, '/defaultValue', new Set());
  return issues;
}

export function projectProperty(
  model: PropertyModel,
  profile: Readonly<PropertyProfile>,
  context: ProjectionContext,
): PropertyProjection {
  const snapshot = freezeJson(cloneJson(model));
  const profileSnapshot = createPropertyProfile(profile as PropertyProfile);
  const issues = validateSourceGraph(model.source.graph);
  if (issues.length)
    return { model: snapshot, profile: profileSnapshot, outcome: 'unsupported', issues, requirements: [] };
  const requirements: PropertyProjection['requirements'] = [];
  let conditional = false;
  let unsupported = issues.length > 0;
  const require = (path: string, capability: string): void => {
    const key = `${path}:${capability}`;
    const availability = own(context.capabilities, key) ? context.capabilities[key]! : 'unknown';
    if (!['enabled', 'unavailable', 'unknown'].includes(availability)) {
      unsupported = true;
      issues.push({ path, message: 'Invalid caller capability' });
      return;
    }
    requirements.push({ path, capability, availability });
    if (availability === 'unavailable') unsupported = true;
    if (availability === 'unknown') conditional = true;
  };
  for (const requirement of profileSnapshot.requirements) require(requirement.path, requirement.capability);
  const representation = model.representation;
  if (!representation)
    return {
      model: snapshot,
      profile: profileSnapshot,
      outcome: 'unsupported',
      issues: [...issues, { path: '/representation', message: 'No representation decision' }],
      requirements,
    };
  const target = cdfToTarget(cloneJson(representation));
  if (isSourceBoundRepresentation(target.type)) {
    const proposal = model.representationProposal;
    const validation = validateRepresentationProposal(proposal, model, () => ({
      status: 'unknown',
      requirements: [{ path: '', capability: 'deployed-mapper', availability: 'unknown' }],
    }));
    const compared = cloneJson(target);
    if (proposal?.desiredDefinition.required === undefined) delete compared.required;
    if (!validation.valid || !proposal || !jsonEqual(proposal.desiredDefinition, compared)) {
      unsupported = true;
      issues.push(...validation.issues, {
        path: '/representationProposal',
        message: 'Source-bound proposal must match the complete desired definition',
      });
    } else if (proposal.compatibility?.status !== 'judged-compatible') {
      conditional = true;
      issues.push({
        path: '/representationProposal/compatibility',
        message: 'Source compatibility remains unresolved',
      });
    }
    const root = model.source.graph.nodes.find((node) => node.id === model.source.graph.rootId);
    if (target.required !== undefined && target.required !== root?.required) {
      unsupported = true;
      issues.push({ path: '/required', message: 'Representation does not preserve source requiredness' });
    }
  }
  const sourceDefault = model.source.default;
  if (sourceDefault?.state === 'unsupported') {
    issues.push({ path: '/source/default', message: 'Source default unresolved; source retained' });
    if (model.defaultIntent.action === 'absent' || model.defaultAuthority === 'generation') conditional = true;
  }
  if (
    model.defaultAuthority === 'generation' &&
    sourceDefault?.state === 'value' &&
    own(sourceDefault, 'value') &&
    (model.defaultIntent.action === 'clear' ||
      (model.defaultIntent.action === 'set' && !jsonEqual(model.defaultIntent.value, sourceDefault.value)))
  ) {
    unsupported = true;
    issues.push({ path: '/defaultIntent', message: 'Generated default differs from original source default' });
  }
  if (model.defaultAuthority === 'review' && model.defaultIntent.action !== 'absent')
    issues.push({
      path: '/source/default',
      message: 'Original source default retained independently of accepted review intent',
    });
  const visit = (
    d: CDFFieldDefinition,
    t: TargetDefinition,
    path: string,
    position: 'root' | 'item' | 'field',
    literalUnderlying = false,
  ): void => {
    if (!profile.mapperTypes.includes(d.$type) || !profile.targetTypes.includes(t.type)) {
      unsupported = true;
      issues.push({ path, message: 'Mapper type unavailable' });
    }
    require(path, 'mapper');
    if (path && isSourceBoundRepresentation(d.$type) && !literalUnderlying) {
      unsupported = true;
      issues.push({ path, message: 'Nested source-bound representation requires its own compatibility judgment' });
    }
    if (literalUnderlying && ['RichText', 'ResourceLink'].includes(d.$type)) {
      unsupported = true;
      issues.push({ path, message: 'Literal singleton does not prove source-bound underlying semantics' });
    }
    if ((d.$type === 'array' && position !== 'root') || (d.$type === 'record' && position === 'field')) {
      unsupported = true;
      issues.push({ path, message: 'Native position unavailable; source retained' });
    }
    if (d.$items) visit(d.$items, t.items!, `${path}/items`, 'item', literalUnderlying);
    if (d.$fields)
      for (const [key, field] of Object.entries(d.$fields))
        visit(field, t.fields![key]!, childPath(childPath(path, 'fields'), key), 'field', literalUnderlying);
    if (d.valueType) visit(d.valueType, t.valueType!, `${path}/valueType`, position, true);
  };
  visit(representation, target, '', 'root');
  if (model.defaultIntent.action === 'clear') delete target.defaultValue;
  else if (model.defaultIntent.action === 'set') target.defaultValue = cloneJson(model.defaultIntent.value);
  else if (
    !own(target, 'defaultValue') &&
    model.source.default?.state === 'value' &&
    own(model.source.default, 'value')
  )
    target.defaultValue = cloneJson(model.source.default.value!);
  let lossy = false;
  const defaults = (d: CDFFieldDefinition, t: TargetDefinition, path: string): void => {
    if (own(t, 'defaultValue')) {
      if (!profile.defaultSourceTypes.includes(d.$type) || !profile.defaultTargetTypes.includes(t.type)) {
        delete t.defaultValue;
        lossy = true;
        issues.push({
          path: `${path}/defaultValue`,
          message: 'Source mapper and mapped target must both support default',
        });
      } else require(path, 'default');
    }
    if (d.$items) defaults(d.$items, t.items!, `${path}/items`);
    if (d.valueType) defaults(d.valueType, t.valueType!, `${path}/valueType`);
    if (d.$fields)
      for (const [key, field] of Object.entries(d.$fields))
        defaults(field, t.fields![key]!, childPath(childPath(path, 'fields'), key));
  };
  defaults(representation, target, '');
  const validation = validateTargetDefinition(target);
  issues.push(...validation.issues);
  if (validation.valid) {
    const domainIssues = isSourceBoundRepresentation(target.type)
      ? []
      : validateSourceDomain(model.source.graph, target);
    issues.push(...domainIssues);
    if (domainIssues.length) unsupported = true;
  }
  if (
    !validation.valid ||
    issues.some(
      (issue) =>
        issue.message === 'Default outside proven source domain' ||
        issue.message === 'Value outside declared domain' ||
        issue.message === 'Source field missing from representation',
    )
  )
    unsupported = true;
  if (model.source.graph.coverage !== 'complete-within-declared-bound') conditional = true;
  return {
    model: snapshot,
    profile: profileSnapshot,
    outcome: unsupported ? 'unsupported' : conditional ? 'conditional' : lossy ? 'lossy' : 'supported',
    ...(unsupported ? {} : { target }),
    issues,
    requirements,
  };
}

export interface RepresentationAlternative {
  sourceRevision: string;
  sourceNodeIds: string[];
  kind: 'json-document' | 'record-component';
  definition: TargetDefinition;
  accounting: Array<{ nodeId: string; keyPath: string[]; disposition: 'retained' }>;
  dependencies: string[];
  mapper: MapperAvailability;
  cardinality: MapperAvailability;
  approved: false;
}
/** Generic drafts preserve complete accounting; deployment and approval are caller responsibilities. */
export function deriveRepresentationAlternatives(model: PropertyModel): RepresentationAlternative[] {
  const graph = model.source.graph;
  const accounting = graph.nodes.map((node) => ({
    nodeId: node.id,
    keyPath: [...node.keyPath],
    disposition: 'retained' as const,
  }));
  const alternatives: RepresentationAlternative[] = [
    {
      sourceRevision: model.identity.sourceRevision,
      sourceNodeIds: graph.nodes.map((n) => n.id),
      kind: 'json-document',
      definition: { type: 'JSON' },
      accounting,
      dependencies: [],
      mapper: 'unknown',
      cardinality: 'unknown',
      approved: false,
    },
  ];
  for (const node of graph.nodes)
    if (node.kind === 'record' && node.fields?.length) {
      const fields: Record<string, TargetDefinition> = Object.create(null);
      for (const field of node.fields) fields[field.key] = { type: 'JSON', required: field.required };
      alternatives.push({
        sourceRevision: model.identity.sourceRevision,
        sourceNodeIds: [node.id],
        kind: 'record-component',
        definition: { type: 'Record', fields },
        accounting,
        dependencies: node.fields.map((field) => field.nodeId),
        mapper: 'unknown',
        cardinality: 'unknown',
        approved: false,
      });
    }
  return alternatives;
}
