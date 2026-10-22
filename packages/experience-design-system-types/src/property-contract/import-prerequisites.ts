import {
  CDFComponentSchema,
  CDFTokenSchema,
  type CDFComponentEntry,
  type CDFFieldDefinition,
  type CDFTokenEntry,
} from '../cdf/types.js';
import { DESIGN_TOKEN_TYPES, type DesignTokenType } from '../dtcg/token-types.js';
import { contentDigest } from './content-digest.js';
import { validateRepresentationClosure } from '../cdf/representation-validation.js';
import { childPath, freezeJson, cloneJson, jsonValueIssue } from './json-value.js';

export type ResourceDependencyKey =
  | { kind: 'DesignToken'; namespace: 'dtcg-path'; value: string }
  | { kind: 'Component'; namespace: 'cdf-key'; value: string };

export interface ImportPrerequisiteManifest {
  components: readonly { key: string; entry: CDFComponentEntry }[];
  tokens: readonly { path: string; entry: CDFTokenEntry }[];
}
export interface ImportPrerequisiteEdge {
  owner: ResourceDependencyKey;
  dependency: ResourceDependencyKey;
}
export interface ImportPrerequisiteObligation {
  owner: ResourceDependencyKey;
  path: string;
  reference: { namespace: 'dtcg-path'; value: string };
  expectedKind: DesignTokenType;
  resolution: 'planned' | 'unknown';
  definitionIdentity?: string;
}
export interface ImportPrerequisitePlan {
  revision: 1;
  manifestIdentity: string;
  tokenManifestIdentity: string;
  graphIdentity: string;
  orderedKeys: string[];
  edges: ImportPrerequisiteEdge[];
  obligations: ImportPrerequisiteObligation[];
  capabilityRequirements: Array<{ owner: ResourceDependencyKey; path: string; capability: string }>;
}
export interface ImportPrerequisiteIssue {
  code: string;
  path: string;
  message: string;
}
export type ImportPrerequisiteValidation =
  | { valid: true; plan: Readonly<ImportPrerequisitePlan>; errors: [] }
  | { valid: false; errors: ImportPrerequisiteIssue[] };

export function importTokenDefinitionIdentity(path: string, entry: CDFTokenEntry): string {
  return contentDigest({ path, entry });
}
export function importTokenManifestIdentity(tokens: ImportPrerequisiteManifest['tokens']): string {
  return contentDigest([...tokens].sort((left, right) => left.path.localeCompare(right.path)));
}
export function importDependencyKey(key: ResourceDependencyKey): string {
  return `${key.kind}:${JSON.stringify([key.namespace, key.value])}`;
}

/** Local plans establish dependencies; absent target resources remain unknown. */
export function createImportPrerequisitePlan(input: ImportPrerequisiteManifest): ImportPrerequisiteValidation {
  const errors: ImportPrerequisiteIssue[] = [];
  const components = new Map<string, CDFComponentEntry>();
  const tokens = new Map<string, CDFTokenEntry>();
  const edges = new Map<string, ImportPrerequisiteEdge>();
  const obligations: ImportPrerequisiteObligation[] = [];
  const capabilityRequirements: ImportPrerequisitePlan['capabilityRequirements'] = [];
  const nodes = new Set<string>();
  const issue = (code: string, path: string, message: string): void => {
    errors.push({ code, path, message });
  };
  const componentKey = (value: string): ResourceDependencyKey => ({ kind: 'Component', namespace: 'cdf-key', value });
  const tokenKey = (value: string): ResourceDependencyKey => ({ kind: 'DesignToken', namespace: 'dtcg-path', value });
  const addEdge = (owner: ResourceDependencyKey, dependency: ResourceDependencyKey): void => {
    edges.set(JSON.stringify([importDependencyKey(owner), importDependencyKey(dependency)]), { owner, dependency });
  };
  for (const [index, component] of input.components.entries()) {
    if (!component.key || components.has(component.key)) {
      issue('component-owner-duplicate', `/components/${index}/key`, 'Duplicate or empty Component key');
      continue;
    }
    if (!CDFComponentSchema.safeParse(component.entry).success) {
      issue('component-definition-invalid', `/components/${index}`, 'Invalid Component definition');
      continue;
    }
    components.set(component.key, component.entry);
    nodes.add(importDependencyKey(componentKey(component.key)));
  }
  for (const [index, token] of input.tokens.entries()) {
    if (!token.path || tokens.has(token.path)) {
      issue('token-definition-duplicate', `/tokens/${index}/path`, 'Duplicate or empty DesignToken path');
      continue;
    }
    if (jsonValueIssue(token.entry) || !CDFTokenSchema.safeParse(token.entry).success) {
      issue('token-definition-invalid', `/tokens/${index}`, 'Invalid DesignToken definition');
      continue;
    }
    tokens.set(token.path, token.entry);
    nodes.add(importDependencyKey(tokenKey(token.path)));
  }
  if (errors.length) return { valid: false, errors };

  const visit = (
    owner: ResourceDependencyKey,
    definition: CDFFieldDefinition,
    path: string,
    category: CDFFieldDefinition['$category'],
  ): void => {
    if (category === 'design' && definition.$type === 'token') {
      const kind = definition['$token.kind'];
      if (!(DESIGN_TOKEN_TYPES as readonly unknown[]).includes(kind)) {
        issue('token-kind-invalid', `${path}/$token.kind`, 'Token properties require a recognized token kind');
      } else {
        const references = (definition['$token.allowed'] ?? []).map((value, index) => ({
          value,
          path: `${path}/$token.allowed/${index}`,
        }));
        if (typeof definition.$default === 'string')
          references.push({ value: definition.$default, path: `${path}/$default` });
        for (const reference of references) {
          if (!reference.value.trim()) {
            issue('token-reference-invalid', reference.path, 'Token reference must not be empty');
            continue;
          }
          const planned = tokens.get(reference.value);
          if (planned && planned.$type !== kind) {
            issue('token-kind-mismatch', reference.path, 'Planned token kind differs from the property kind');
            continue;
          }
          obligations.push({
            owner,
            path: reference.path,
            reference: { namespace: 'dtcg-path', value: reference.value },
            expectedKind: kind as DesignTokenType,
            resolution: planned ? 'planned' : 'unknown',
            ...(planned ? { definitionIdentity: importTokenDefinitionIdentity(reference.value, planned) } : {}),
          });
          if (planned) addEdge(owner, tokenKey(reference.value));
        }
      }
    }
    if (definition.$items) visit(owner, definition.$items, `${path}/$items`, category);
    if (definition.valueType) visit(owner, definition.valueType, `${path}/valueType`, category);
    for (const [index, member] of (definition.members ?? []).entries())
      visit(owner, member, `${path}/members/${index}`, category);
    for (const [key, field] of Object.entries(definition.$fields ?? {}))
      visit(owner, field, childPath(`${path}/$fields`, key), category);
  };
  for (const [key, component] of components) {
    const owner = componentKey(key);
    for (const [name, definition] of Object.entries(component.$properties))
      visit(owner, definition, childPath(`${childPath('', key)}/$properties`, name), definition.$category);
    for (const [name, slot] of Object.entries(component.$slots ?? {})) {
      if (!slot.$modelBinding) continue;
      for (const allowed of slot.$allowedComponents ?? []) {
        if (components.has(allowed)) addEdge(owner, componentKey(allowed));
        else
          issue(
            'prerequisite-node-missing',
            childPath(`${childPath('', key)}/$slots`, name),
            'Generated model dependency is missing',
          );
      }
    }
    for (const [name, plan] of Object.entries(component.$representationPlans ?? {})) {
      if (!Array.isArray(plan.requirements)) {
        issue(
          'import-model-invalid',
          childPath(`${childPath('', key)}/$representationPlans`, name),
          'Representation requirements are missing',
        );
        continue;
      }
      for (const requirement of plan.requirements)
        capabilityRequirements.push({ owner, path: requirement.path, capability: requirement.capability });
      for (const allowed of plan.attachment?.definition.$allowedComponents ?? []) {
        if (!components.has(allowed))
          issue(
            'prerequisite-node-missing',
            childPath(`${childPath('', key)}/$representationPlans`, name),
            'Representation model dependency is missing',
          );
        else addEdge(owner, componentKey(allowed));
      }
    }
  }

  const orderedEdges = [...edges.values()].sort(
    (a, b) =>
      importDependencyKey(a.owner).localeCompare(importDependencyKey(b.owner)) ||
      importDependencyKey(a.dependency).localeCompare(importDependencyKey(b.dependency)),
  );
  const remaining = new Map([...nodes].map((node) => [node, new Set<string>()]));
  for (const edge of orderedEdges)
    remaining.get(importDependencyKey(edge.owner))!.add(importDependencyKey(edge.dependency));
  const orderedKeys: string[] = [];
  while (remaining.size) {
    let ready = [...remaining]
      .filter(([, dependencies]) => dependencies.size === 0)
      .map(([key]) => key)
      .sort();
    if (!ready.length) {
      const groups = new Map<string, Set<string>>();
      for (const [key, component] of components) {
        if (!component.$model) continue;
        const identity = component.$model;
        const groupId = JSON.stringify([identity.planId, identity.componentId, identity.propertyId]);
        const node = importDependencyKey(componentKey(key));
        if (!remaining.has(node)) continue;
        const group = groups.get(groupId) ?? new Set<string>();
        group.add(node);
        groups.set(groupId, group);
      }
      // Recursive definitions form a finite model group; instances remain ordinary finite trees.
      // Such a group requires staged downstream creation rather than dependency-first creation.
      const group = [...groups.values()].find((members) =>
        [...members].every((node) => [...remaining.get(node)!].every((dependency) => members.has(dependency))),
      );
      if (group && !validateRepresentationClosure(input.components.map((component) => ({ ...component }))).length)
        ready = [...group].sort();
    }
    if (!ready.length) {
      issue('prerequisite-cycle', '', 'Import prerequisite graph contains a cycle');
      break;
    }
    for (const key of ready) {
      orderedKeys.push(key);
      remaining.delete(key);
    }
    for (const dependencies of remaining.values()) for (const key of ready) dependencies.delete(key);
  }
  if (errors.length) return { valid: false, errors };
  const manifestIdentity = contentDigest({
    components: [...input.components].sort((a, b) => a.key.localeCompare(b.key)),
    tokens: [...input.tokens].sort((a, b) => a.path.localeCompare(b.path)),
  });
  obligations.sort((a, b) => a.path.localeCompare(b.path));
  capabilityRequirements.sort(
    (a, b) =>
      importDependencyKey(a.owner).localeCompare(importDependencyKey(b.owner)) ||
      a.path.localeCompare(b.path) ||
      a.capability.localeCompare(b.capability),
  );
  return {
    valid: true,
    errors: [],
    plan: freezeJson(
      cloneJson({
        revision: 1 as const,
        manifestIdentity,
        tokenManifestIdentity: importTokenManifestIdentity(input.tokens),
        graphIdentity: contentDigest({
          manifestIdentity,
          orderedKeys,
          edges: orderedEdges,
          obligations,
          capabilityRequirements,
        }),
        orderedKeys,
        edges: orderedEdges,
        obligations,
        capabilityRequirements,
      }),
    ),
  };
}

export const validateImportPrerequisites = createImportPrerequisitePlan;
