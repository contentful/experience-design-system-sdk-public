/**
 * `experiences doctor` streams its findings as each check runs rather than
 * repainting a screen, so it writes ANSI directly instead of mounting the Ink
 * setup UI.
 */

export function ok(msg: string): void {
  process.stdout.write(`  \x1b[32m✓\x1b[0m  ${msg}\n`);
}

export function fail(msg: string): void {
  process.stdout.write(`  \x1b[31m✗\x1b[0m  ${msg}\n`);
}

export function warn(msg: string): void {
  process.stdout.write(`  \x1b[33m⚠\x1b[0m  ${msg}\n`);
}

export function info(msg: string): void {
  process.stdout.write(`     ${msg}\n`);
}

export function section(title: string): void {
  process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`);
}

/** Echo the first `limit` lines of a failed command's stderr. */
export function infoStderr(stderr: string, limit: number): void {
  for (const line of stderr.trim().split('\n').slice(0, limit)) info(line);
}
