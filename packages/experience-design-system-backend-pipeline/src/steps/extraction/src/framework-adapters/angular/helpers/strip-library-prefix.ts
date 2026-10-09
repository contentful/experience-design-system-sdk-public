/**
 * Common Angular design-system library prefixes observed in the real-world
 * corpus (Material, NG-ZORRO, Carbon, Clarity, Spartan, Taiga, Nebular, SAP).
 * Order matters only when prefixes nest — none do today.
 */
const KNOWN_PREFIXES = ['Mat', 'Cdk', 'Nz', 'Cds', 'Ibm', 'Clr', 'Hlm', 'Brn', 'Tui', 'Nb', 'Fd', 'P', 'Ng'];

/**
 * Strip a known library prefix from an identifier. Used to turn
 * `MatCardTitle` → `CardTitle`, `NzSize` → `Size`, `HlmCardHeader` → `CardHeader`.
 *
 * Returns the original value when no prefix matches, or when the result would
 * be empty / start with a lowercase letter (prevents `Mat` → `` and `My` → `y`).
 */
export function stripLibraryPrefix(name: string): string {
  for (const prefix of KNOWN_PREFIXES) {
    if (name.startsWith(prefix) && name.length > prefix.length) {
      const rest = name.slice(prefix.length);
      if (rest[0] && rest[0] === rest[0].toUpperCase()) {
        return rest;
      }
    }
  }
  return name;
}
