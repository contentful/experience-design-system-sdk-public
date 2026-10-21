import { canonicalComponentSource, type KnownComponent } from '../helpers/identity.js';
import { eligibleScopes } from '../helpers/eligible-scopes.js';
import { sameValue } from '../helpers/same-value.js';
import {
  ABSENT,
  EXPLORE_SCOPES,
  type DiffScope,
  ExplorationConsensusField,
  ExplorationDiff,
  ExplorationDisagreement,
  ExplorationSingleVoter,
  ExploreComponentReport,
  ExplorePropReport,
  ExploreScope,
  ExploreScopeResult,
  ExploreSlotEvidence,
  jsonEqual,
} from '@contentful/experience-design-system-types';

const PROP_FIELDS = [
  'category',
  'type',
  'values',
  'observedValues',
  'tokenKind',
  'tokenPaths',
  'required',
  'default',
  'description',
  'representationProposal',
] as const;
const SLOT_FIELDS = ['isRealSlot', 'allowedComponents', 'required'] as const;

export function explorationFieldPath(
  component: string,
  source: string,
  scope: DiffScope,
  member: string | undefined,
  field: string,
): string {
  const root = `${component}::${source}`;
  if (scope === 'component') return `${root}#${field}`;
  return `${root}#${scope === 'prop' ? 'props' : 'slots'}.${member}.${field}`;
}

export function explorationDisagreementId(path: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    hash ^= path.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `x${hash.toString(16).padStart(8, '0')}`;
}

interface ComponentEntry {
  name: string;
  source: string;
  byScope: Map<ExploreScope, ExploreComponentReport>;
}

type FieldProviders = Array<{ scope: ExploreScope; value: unknown; reason?: string }>;

export function diffExploration(scopes: ExploreScopeResult[], known?: KnownComponent[]): ExplorationDiff {
  const resolveSource = canonicalComponentSource(known);
  const warnings: string[] = [];
  const registry = new Map<string, ComponentEntry>();

  for (const result of scopes) {
    const seenInScope = new Set<string>();
    for (const component of result.companion.components) {
      const source = resolveSource(component.name, component.source);
      if (source === null) {
        warnings.push(`${result.scope}: ignored unknown component ${component.name} (${component.source})`);
        continue;
      }
      const key = `${component.name}::${source}`;
      if (seenInScope.has(key)) {
        warnings.push(`${result.scope}: duplicate entry for ${key}; the first was kept`);
        continue;
      }
      seenInScope.add(key);
      const entry = registry.get(key) ?? { name: component.name, source, byScope: new Map() };
      entry.byScope.set(result.scope, component);
      registry.set(key, entry);
    }
  }

  const consensus: ExplorationConsensusField[] = [];
  const disagreements: ExplorationDisagreement[] = [];
  const singleVoters: ExplorationSingleVoter[] = [];

  const settle = (
    entry: ComponentEntry,
    scope: DiffScope,
    member: string | undefined,
    field: string,
    reported: FieldProviders,
  ): void => {
    // A scope that was not asked about this field does not vote on it, even if it reported a value.
    const askedScopes = new Set<string>(eligibleScopes(scope, field, EXPLORE_SCOPES));
    const stated = reported.filter((provider) => askedScopes.has(provider.scope));
    if (stated.length === 0) return;
    const path = explorationFieldPath(entry.name, entry.source, scope, member, field);
    const id = explorationDisagreementId(path);

    if (scope === 'prop' && field === 'description') {
      consensus.push({ path, value: stated[0]!.value, coverage: stated.length, providers: stated.map((p) => p.scope) });
      return;
    }

    const statedScopes = new Set(stated.map((provider) => provider.scope));
    const absent = eligibleScopes(scope, field, EXPLORE_SCOPES).filter(
      (candidate) => entry.byScope.has(candidate) && !statedScopes.has(candidate),
    );
    const voters = stated.length + absent.length;

    if (voters === 1) {
      const only = stated[0]!;
      singleVoters.push({
        id,
        component: entry.name,
        source: entry.source,
        scope,
        ...(member !== undefined ? { member } : {}),
        field,
        path,
        provider: only.scope,
        value: only.value,
        ...(only.reason !== undefined ? { reason: only.reason } : {}),
      });
      return;
    }

    const equal = field === 'representationProposal' || field === 'values' ? jsonEqual : sameValue;
    if (absent.length === 0 && stated.every((provider) => equal(provider.value, stated[0]!.value))) {
      consensus.push({
        path,
        value: stated[0]!.value,
        coverage: stated.length,
        providers: stated.map((provider) => provider.scope),
      });
      return;
    }

    const all = [...stated, ...absent.map((scopeName) => ({ scope: scopeName, value: ABSENT, reason: undefined }))];
    disagreements.push({
      id,
      component: entry.name,
      source: entry.source,
      scope,
      ...(member !== undefined ? { member } : {}),
      field,
      path,
      valuesByScope: Object.fromEntries(all.map((provider) => [provider.scope, provider.value])),
      reasonsByScope: Object.fromEntries(
        all.filter((provider) => provider.reason !== undefined).map((provider) => [provider.scope, provider.reason]),
      ),
      ...(absent.length > 0 ? { existenceDispute: true } : {}),
    });
  };

  const entries = [...registry.values()].sort((a, b) =>
    `${a.name}::${a.source}`.localeCompare(`${b.name}::${b.source}`),
  );

  for (const entry of entries) {
    const included: FieldProviders = [];
    for (const [scope, component] of entry.byScope) {
      if (typeof component.included === 'boolean') {
        included.push({ scope, value: component.included, reason: component.inclusionReasoning });
      }
    }
    settle(entry, 'component', undefined, 'included', included);

    const propNames = new Set<string>();
    const slotNames = new Set<string>();
    for (const component of entry.byScope.values()) {
      for (const prop of component.props ?? []) propNames.add(prop.name);
      for (const slot of component.slots ?? []) slotNames.add(slot.name);
    }

    for (const propName of [...propNames].sort()) {
      for (const field of PROP_FIELDS) {
        const providers: FieldProviders = [];
        for (const [scope, component] of entry.byScope) {
          const prop = (component.props ?? []).find((candidate) => candidate.name === propName);
          const value = prop?.[field as keyof ExplorePropReport];
          if (prop && value !== undefined) providers.push({ scope, value, reason: prop.reasoning });
        }
        settle(entry, 'prop', propName, field, providers);
      }
    }

    for (const slotName of [...slotNames].sort()) {
      for (const field of SLOT_FIELDS) {
        const providers: FieldProviders = [];
        for (const [scope, component] of entry.byScope) {
          const slot = (component.slots ?? []).find((candidate) => candidate.name === slotName);
          const value = slot?.[field as keyof ExploreSlotEvidence];
          if (slot && value !== undefined) providers.push({ scope, value, reason: slot.reasoning });
        }
        settle(entry, 'slot', slotName, field, providers);
      }
    }
  }

  return {
    consensus,
    disagreements,
    singleVoters,
    warnings,
    scopesRead: scopes.length,
    componentsSeen: entries.length,
  };
}
