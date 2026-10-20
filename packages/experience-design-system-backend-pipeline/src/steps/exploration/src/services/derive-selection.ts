import { canonicalComponentSource, type KnownComponent } from '../helpers/identity.js';
import { eligibleScopes, meetsSupermajority } from '../helpers/eligible-scopes.js';
import { EXPLORE_SCOPES, type ExploreScopeResult } from '@contentful/experience-design-system-types';

interface InclusionVote {
  scope: string;
  included: boolean;
  reason: string;
}

export interface DerivedSelection {
  componentKey: string;
  name: string;
  source: string;
  decision?: 'accepted' | 'rejected';
  reason: string;
  votes: { accepted: number; rejected: number };
  dissent: InclusionVote[];
  disputed: boolean;
}

export type { KnownComponent };

export function selectionComponentKey(name: string, source: string): string {
  return JSON.stringify([name, source]);
}

function describeDissent(dissent: InclusionVote[]): string {
  return dissent
    .map((vote) => `${vote.scope} ${vote.included ? 'would include it' : 'would exclude it'}: ${vote.reason}`)
    .join(' ');
}

/**
 * Accept or reject a component when at least 75% of the agents that judge inclusion agree, and dispute
 * it otherwise. An agent that judges inclusion but never lists the component counts as excluding it,
 * but only when it listed some other component, so a scope that was not shown the library votes for nothing.
 */
export function deriveSelectionFromExploration(
  scopes: ExploreScopeResult[],
  known?: KnownComponent[],
): DerivedSelection[] {
  const resolveSource = canonicalComponentSource(known);
  const voters = eligibleScopes('component', 'included', EXPLORE_SCOPES);
  const identity = new Map<string, { name: string; source: string }>();
  const stated = new Map<string, Map<string, InclusionVote>>();
  const active = new Set<string>();

  for (const scope of scopes) {
    if (!voters.includes(scope.scope)) continue;
    for (const component of scope.companion.components) {
      const source = resolveSource(component.name, component.source);
      if (source === null) continue;
      active.add(scope.scope);
      if (typeof component.included !== 'boolean') continue;
      const key = selectionComponentKey(component.name, source);
      identity.set(key, { name: component.name, source });
      const votes = stated.get(key) ?? new Map<string, InclusionVote>();
      votes.set(scope.scope, {
        scope: scope.scope,
        included: component.included,
        reason: component.inclusionReasoning ?? `Reported by ${scope.scope}.`,
      });
      stated.set(key, votes);
    }
  }

  return [...identity.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([componentKey, { name, source }]) => {
      const cast = stated.get(componentKey)!;
      const silent = voters.filter((voter) => active.has(voter) && !cast.has(voter));
      const all: InclusionVote[] = [
        ...cast.values(),
        ...silent.map((scope) => ({ scope, included: false, reason: 'Did not list this component.' })),
      ];
      const accepted = all.filter((vote) => vote.included).length;
      const rejected = all.length - accepted;

      let decision: 'accepted' | 'rejected' | undefined;
      if (meetsSupermajority(accepted, all.length)) decision = 'accepted';
      else if (meetsSupermajority(rejected, all.length)) decision = 'rejected';

      const dissent = decision ? all.filter((vote) => vote.included !== (decision === 'accepted')) : [];
      const majority = all.filter((vote) => decision !== undefined && vote.included === (decision === 'accepted'));
      const disputed = decision === undefined;
      const reason = disputed
        ? `Disputed: ${accepted} of ${all.length} exploration agents would include it.`
        : dissent.length > 0
          ? `${majority[0]?.reason ?? ''} (${dissent.length} of ${all.length} disagreed: ${describeDissent(dissent)})`.trim()
          : (majority[0]?.reason ?? '');

      return {
        componentKey,
        name,
        source,
        ...(decision ? { decision } : {}),
        reason,
        votes: { accepted, rejected },
        dissent,
        disputed,
      };
    });
}
