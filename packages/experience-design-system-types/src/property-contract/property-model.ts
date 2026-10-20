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

export type MapperAvailability = 'enabled' | 'unavailable' | 'unknown';
export interface SourceGraphNode {
  id: string;
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
    originalFacts?: JsonValue;
  };
  category?: 'content' | 'design' | 'state' | 'unattached';
  representation?: CDFFieldDefinition;
  defaultIntent: DefaultIntent;
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
const DEFAULT_TARGETS: TargetPropertyType[] = ['String', 'Number', 'Boolean', 'Array', 'Record'];
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
  mapperTypes: ['string', 'number', 'boolean', 'array', 'record', 'richtext', 'media', 'link', 'token'],
  targetTypes: ['String', 'Number', 'Boolean', 'Array', 'Record'],
  defaultSourceTypes: ['string', 'number', 'boolean', 'array', 'record', 'richtext', 'token'],
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
      typeof node.kind !== 'string' ||
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
  if (fieldCount > graph.limits.maxFields) add('', 'Source field census exceeds bounds');
  return issues;
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
  const visit = (
    d: CDFFieldDefinition,
    t: TargetDefinition,
    path: string,
    position: 'root' | 'item' | 'field',
  ): void => {
    if (!profile.mapperTypes.includes(d.$type) || !profile.targetTypes.includes(t.type)) {
      unsupported = true;
      issues.push({ path, message: 'Mapper type unavailable' });
    }
    require(path, 'mapper');
    if ((d.$type === 'array' && position !== 'root') || (d.$type === 'record' && position === 'field')) {
      unsupported = true;
      issues.push({ path, message: 'Native position unavailable; source retained' });
    }
    if (d.$items) visit(d.$items, t.items!, `${path}/items`, 'item');
    if (d.$fields)
      for (const [key, field] of Object.entries(d.$fields))
        visit(field, t.fields![key]!, childPath(childPath(path, 'fields'), key), 'field');
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
    if (d.$fields)
      for (const [key, field] of Object.entries(d.$fields))
        defaults(field, t.fields![key]!, childPath(childPath(path, 'fields'), key));
  };
  defaults(representation, target, '');
  const validation = validateTargetDefinition(target);
  issues.push(...validation.issues);
  if (validation.valid) {
    const domainIssues = validateSourceDomain(model.source.graph, target);
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
