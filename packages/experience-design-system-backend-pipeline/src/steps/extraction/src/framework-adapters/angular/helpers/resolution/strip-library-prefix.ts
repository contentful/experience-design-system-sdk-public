// Prefixes observed in the real-world Angular DS corpus:
// Material (Mat/Cdk), NG-ZORRO (Nz), Carbon (Cds/Ibm), Clarity (Clr),
// Spartan (Hlm/Brn), Taiga (Tui), Nebular (Nb), SAP Fundamentals (Fd), PrimeNG (P).
const KNOWN_PREFIXES = ['Mat', 'Cdk', 'Nz', 'Cds', 'Ibm', 'Clr', 'Hlm', 'Brn', 'Tui', 'Nb', 'Fd', 'P'];

/**
 * Strip a known library prefix from a PascalCase identifier.
 * Returns the original value when no prefix matches, or when the result would
 * start with a lowercase letter (prevents `My` → `y`).
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
