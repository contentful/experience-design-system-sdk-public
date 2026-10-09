/** Lowercase, strip non-alphanumerics, drop a trailing `s`. Folds `Btn-Primary` and `btnPrimary` → `btnprimary`. */
export function simplifyNameForComparison(name: string): string {
  const stripped = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return stripped.endsWith('s') && stripped.length > 1 ? stripped.slice(0, -1) : stripped;
}
