let cliVersionString = '0.0.0-unknown';

/**
 * Caller sets the CLI version string at startup. Each entry point (legacy's
 * `program.ts` or v2's TUI entry) resolves its own package.json version — bp
 * stays agnostic because the two caller packages ship on different cadences.
 */
export function setCliVersion(version: string): void {
  cliVersionString = version;
}

export function cliVersion(): string {
  return cliVersionString;
}

export function resetCliVersionForTests(): void {
  cliVersionString = '0.0.0-unknown';
}
