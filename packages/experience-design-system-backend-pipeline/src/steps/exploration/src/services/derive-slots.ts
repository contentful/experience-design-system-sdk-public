import {
  SLOT_THRESHOLD,
  ABSENT,
  type DerivedSlots,
  type ExploreScopeResult,
  type KnownComponent,
  type SlotDecision,
} from '@contentful/experience-design-system-types';
import { eligibleScopes } from '../helpers/eligible-scopes.js';
import { EXPLORE_SCOPES } from '@contentful/experience-design-system-types';
import { explorationDisagreementId, explorationFieldPath } from './diff-exploration.js';
export { SLOT_THRESHOLD };
export type {
  DerivedSlots,
  DerivedSlot,
  DerivedComponentSlots,
  SlotDispute,
} from '@contentful/experience-design-system-types';
export function deriveSlotsFromExploration(
  scopes: ExploreScopeResult[],
  known: KnownComponent[],
  allowedChildren: ReadonlySet<string>,
): DerivedSlots {
  const components: DerivedSlots['components'] = [];
  const disputes: DerivedSlots['disputes'] = [];
  const decisions: SlotDecision[] = [];
  const voters = new Set(eligibleScopes('slot', 'isRealSlot', EXPLORE_SCOPES));
  const meets = (count: number, total: number): boolean => total > 0 && count / total >= SLOT_THRESHOLD;
  for (const component of known) {
    const coverage = scopes
      .filter((result) => voters.has(result.scope))
      .flatMap((result) => {
        const report = result.companion.components.find(
          (report) => report.name === component.name && report.source === component.source,
        );
        return report ? [{ scope: result.scope, report }] : [];
      });
    const names = new Set(coverage.flatMap(({ report }) => (report.slots ?? []).map((slot) => slot.name)));
    const accepted: DerivedSlots['components'][number] = { ...component, slots: [] };
    for (const name of [...names].sort()) {
      const votes = coverage.map(({ scope, report }) => ({
        scope,
        slot: report.slots?.find((slot) => slot.name === name),
      }));
      const real = votes.filter((vote) => vote.slot?.isRealSlot);
      const total = votes.length;
      let state: SlotDecision['state'] = 'unresolved';
      let allowed: string[] = [];
      const finite = new Map<string, number>();
      for (const { slot } of real) {
        if (!slot?.restriction?.supported || !slot.restriction.applicable) continue;
        for (const child of new Set(slot.allowedComponents ?? [])) {
          if (allowedChildren.has(child) && child !== component.name) finite.set(child, (finite.get(child) ?? 0) + 1);
        }
      }
      if (!meets(real.length, total)) {
        if (meets(total - real.length, total)) state = 'false';
      } else {
        allowed = [...finite]
          .filter(([, count]) => meets(count, total))
          .map(([child]) => child)
          .sort();
        if (allowed.length) state = 'finite';
        else {
          const open = real.filter(
            ({ slot }) =>
              !(slot?.allowedComponents ?? []).some((child) => allowedChildren.has(child) || child === component.name),
          );
          if (meets(open.length, real.length)) state = 'open';
        }
      }
      const evidence = real.flatMap(({ slot }) => (slot?.restriction?.supported ? slot.restriction.evidence : []));
      const required = undefined;
      const decision: SlotDecision = {
        ...component,
        slot: name,
        state,
        allowedComponents: state === 'finite' ? allowed : [],
        evidence,
        coverage: total,
        realVotes: real.length,
        ...(required !== undefined ? { required } : {}),
      };
      decisions.push(decision);
      if (state === 'open' || state === 'finite')
        accepted.slots.push({
          name,
          allowedComponents: decision.allowedComponents,
          state,
          ...(required !== undefined ? { required } : {}),
          evidence,
        });
      const proposedKnown = real.some(({ slot }) =>
        (slot?.allowedComponents ?? []).some((child) => allowedChildren.has(child) && !allowed.includes(child)),
      );
      if (state === 'unresolved' || (real.length && real.length !== total) || proposedKnown) {
        const field = state === 'unresolved' && !meets(real.length, total) ? 'isRealSlot' : 'allowedComponents';
        disputes.push({
          component: component.name,
          source: component.source,
          slot: name,
          field,
          disputeId: explorationDisagreementId(
            explorationFieldPath(component.name, component.source, 'slot', name, field),
          ),
          valuesByScope: Object.fromEntries(
            votes.map((vote) => [
              vote.scope,
              vote.slot
                ? field === 'isRealSlot'
                  ? vote.slot.isRealSlot
                  : (vote.slot.allowedComponents ?? [])
                : ABSENT,
            ]),
          ),
          reasonsByScope: Object.fromEntries(votes.map((vote) => [vote.scope, vote.slot?.reasoning])),
        });
      }
    }
    if (accepted.slots.length) components.push(accepted);
  }
  return { components, disputes, decisions };
}
