import type {
  ExplorationDiff,
  TierHypothesis,
  ExploreSourceRef,
  VerifyComponentWork,
  VerifyItem,
  ExplorationDisagreement,
  ExplorationSourceInput,
} from '@contentful/experience-design-system-types';
import { assertUnique } from './identity.js';
export interface CallSiteEvidenceEntry {
  parent: string;
  parentSource?: string;
  child: string;
  sourcePath: string;
  startLine: number;
  endLine: number;
  excerpt: string;
}
export interface BuildVerifyWorkOptions {
  diff: ExplorationDiff;
  hypotheses: TierHypothesis[];
  sourceRefs?: ExploreSourceRef[];
  callSites?: CallSiteEvidenceEntry[];
  sourceInput?: ExplorationSourceInput;
  skipComponentKeys?: ReadonlySet<string>;
}
export function buildVerifyWork(options: BuildVerifyWorkOptions): VerifyComponentWork[] {
  const grouped = new Map<string, VerifyComponentWork>();
  const nameOwners = new Map<string, Set<string>>();
  for (const owner of [...options.diff.disagreements, ...options.diff.singleVoters]) {
    const sources = nameOwners.get(owner.component) ?? new Set<string>();
    sources.add(owner.source);
    nameOwners.set(owner.component, sources);
  }
  for (const owner of options.sourceInput?.components ?? []) {
    const sources = nameOwners.get(owner.component) ?? new Set<string>();
    sources.add(owner.source);
    nameOwners.set(owner.component, sources);
  }
  const add = (component: string, source: string, item: VerifyItem): void => {
    const key = JSON.stringify([component, source]);
    if (options.skipComponentKeys?.has(key) || options.skipComponentKeys?.has(`${component}::${source}`)) return;
    const group = grouped.get(key) ?? {
      component,
      source,
      sourceRef: options.sourceRefs?.find((ref) => ref.component === component && ref.sourcePath === source),
      callSites: (options.callSites ?? [])
        .filter(
          (site) =>
            site.parent === component &&
            (site.parentSource ? site.parentSource === source : nameOwners.get(component)?.size === 1),
        )
        .map(({ parent: _parent, ...site }) => site),
      items: [],
      ...(nameOwners.get(component)!.size > 1 &&
      (options.callSites ?? []).some((site) => site.parent === component && !site.parentSource)
        ? { evidenceLimits: ['Unbound call-site excerpts are withheld for repeated component names.'] }
        : {}),
    };
    group.items.push(item);
    grouped.set(key, group);
  };
  const claim = (entry: ExplorationDisagreement) => ({
    id: entry.id,
    path: entry.path,
    scope: entry.scope,
    member: entry.member,
    field: entry.field,
    valuesByScope: entry.valuesByScope,
  });
  assertUnique(
    options.diff.disagreements.map((entry) => entry.id),
    'disagreement IDs',
  );
  for (const hypothesis of options.hypotheses) {
    if (hypothesis.tier !== 'factual') continue;
    const entries = hypothesis.disagreementIds.map((id) => {
      const found = options.diff.disagreements.find((entry) => entry.id === id);
      if (!found) throw new Error('Unknown hypothesis ID');
      return found;
    });
    const owners = new Set(entries.map((entry) => JSON.stringify([entry.component, entry.source])));
    for (const key of owners) {
      const own = entries.filter((entry) => JSON.stringify([entry.component, entry.source]) === key);
      const first = own[0]!;
      add(first.component, first.source, {
        itemId: `h-${own[0]!.id}`,
        kind: 'factual',
        hypothesis: hypothesis.hypothesis,
        gatedOn: hypothesis.gatedOn,
        claims: own.map(claim),
      });
    }
  }
  for (const voter of options.diff.singleVoters) {
    if (voter.scope === 'component' && voter.field === 'included') continue;
    add(voter.component, voter.source, {
      itemId: `s-${voter.id}`,
      kind: 'single-voter',
      claims: [
        {
          id: voter.id,
          path: voter.path,
          scope: voter.scope,
          member: voter.member,
          field: voter.field,
          valuesByScope: { [voter.provider]: voter.value },
        },
      ],
    });
  }
  for (const group of grouped.values())
    assertUnique(
      group.items.map((item) => item.itemId),
      'component work IDs',
    );
  return [...grouped.values()];
}
