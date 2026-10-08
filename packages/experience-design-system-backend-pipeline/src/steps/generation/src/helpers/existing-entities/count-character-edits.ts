/**
 * Minimum number of single-character insertions, deletions, or substitutions
 * to change `a` into `b`. Classic Wagner–Fischer with two rolling rows.
 */
export function countCharacterEdits(a: string, b: string): number {
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
      curr[i] = Math.min((curr[i - 1] as number) + 1, (prev[i] as number) + 1, (prev[i - 1] as number) + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length] as number;
}
