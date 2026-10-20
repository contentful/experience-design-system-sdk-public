import {
  CANDIDATE_FREE_SCOPES,
  COMPONENT_SCOPES,
  DETAIL_SCOPES,
  type DiffScope,
  type ExploreScope,
} from '@contentful/experience-design-system-types';

import { SUPERMAJORITY } from '@contentful/experience-design-system-types';
export { SUPERMAJORITY };

/**
 * The scopes that were asked about a field. Silence from one of them is a vote that the field does not
 * exist or is not relevant. A scope outside this list was never asked, so its silence says nothing.
 * Inclusion is judged by all the component runs, before the scope gate. Slots are judged only by the runs that were
 * given the slot candidates: the candidate-free runs add proposals but do not vote on a slot. Every other field is
 * judged by the full inventories after it.
 */
export function eligibleScopes(scope: DiffScope, field: string, all: readonly ExploreScope[]): ExploreScope[] {
  const asked: readonly ExploreScope[] =
    scope === 'component' && field === 'included'
      ? COMPONENT_SCOPES
      : scope === 'slot'
        ? COMPONENT_SCOPES.filter((candidate) => !(CANDIDATE_FREE_SCOPES as readonly string[]).includes(candidate))
        : DETAIL_SCOPES;
  return all.filter((candidate) => asked.includes(candidate));
}

export function meetsSupermajority(agree: number, total: number): boolean {
  return total > 0 && agree / total >= SUPERMAJORITY;
}
