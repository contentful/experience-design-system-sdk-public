const KNOWN_PREFIXES = ['Mat', 'Cdk', 'Nz', 'Cds', 'Ibm', 'Clr', 'Hlm', 'Brn', 'Tui', 'Nb', 'Fd', 'P', 'Ng'];

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
