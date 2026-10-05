import { c } from '../output/format.js';

/**
 * `experiences doctor` streams its findings as each check runs rather than
 * repainting a screen, so it writes lines to stdout instead of mounting Ink.
 * Colors come from the shared formatter, so NO_COLOR turns them off.
 */

const write = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

export function ok(msg: string): void {
  write(`  ${c.green('✓')}  ${msg}`);
}

export function fail(msg: string): void {
  write(`  ${c.red('✗')}  ${msg}`);
}

export function warn(msg: string): void {
  write(`  ${c.yellow('⚠')}  ${msg}`);
}

export function info(msg: string): void {
  write(`     ${msg}`);
}

export function section(title: string): void {
  write(`\n${c.bold(title)}`);
}

/** Echo the first `limit` lines of a failed command's stderr. */
export function infoStderr(stderr: string, limit: number): void {
  for (const line of stderr.trim().split('\n').slice(0, limit)) info(line);
}
