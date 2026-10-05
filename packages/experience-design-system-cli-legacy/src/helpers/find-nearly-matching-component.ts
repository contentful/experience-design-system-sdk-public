import type { ComponentProps } from 'contentful-management';

const MAX_CHARACTER_EDITS_FOR_LIKELY_MATCH = 2;

/**
 * Find the space component whose name is closest to the codebase component name,
 * within a small edit budget. Handles case, punctuation, and plural differences
 * so `Btn-Primary` matches `btnPrimary`, and `Cards` matches `Card`.
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

/**
 * Lowercase, strip everything that isn't a letter or number, and drop a trailing
 * `s` so plurals fold to singular. Turns display-varied names like `Btn-Primary`,
 * `btnPrimary`, and `BTN_PRIMARY` into the same comparable form.
 */
function simplifyNameForComparison(name: string): string {
  const stripped = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return stripped.endsWith('s') && stripped.length > 1 ? stripped.slice(0, -1) : stripped;
}

/**
 * Count the minimum number of single-character insertions, deletions, or
 * substitutions to change `a` into `b`. Used to decide whether two component
 * names are close enough to be considered the same entity (e.g. a typo or
 * a slightly different naming convention).
 */
function countCharacterEdits(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  if (a.length > b.length) [a, b] = [b, a];

  let prev = new Array<number>(a.length + 1);
  let curr = new Array<number>(a.length + 1);

  for (let i = 0; i <= a.length; i++) prev[i] = i;

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(curr[i - 1] + 1, prev[i] + 1, prev[i - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[a.length]!;
}
