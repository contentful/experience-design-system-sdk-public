import type { ComponentProps } from 'contentful-management';
import { countCharacterEdits } from './count-character-edits.js';
import { simplifyNameForComparison } from './simplify-name-for-comparison.js';

const MAX_CHARACTER_EDITS_FOR_LIKELY_MATCH = 2;

/**
 * Find the space Component whose name is closest to `codebaseName`, within
 * a small edit budget. Handles case / punctuation / plural differences so
 * `Btn-Primary` matches `btnPrimary`, `Cards` matches `Card`.
 */
export function findNearlyMatchingComponent(
  components: ComponentProps[],
  codebaseName: string,
): ComponentProps | undefined {
  const target = simplifyNameForComparison(codebaseName);
  if (!target) return undefined;
  let best: { component: ComponentProps; edits: number } | undefined;
  for (const c of components) {
    const edits = countCharacterEdits(target, simplifyNameForComparison(c.name));
    if (edits > MAX_CHARACTER_EDITS_FOR_LIKELY_MATCH) continue;
    if (!best || edits < best.edits) best = { component: c, edits };
    if (edits === 0) break;
  }
  return best?.component;
}
