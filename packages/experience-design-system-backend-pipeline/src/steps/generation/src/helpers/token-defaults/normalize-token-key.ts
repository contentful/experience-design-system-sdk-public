/** Canonicalize a token key: kebab-case + lowercase, so `BtnPrimary` and `btn_primary` collapse. */
export function normalizeTokenKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[ _]+/g, '-')
    .toLowerCase();
}
