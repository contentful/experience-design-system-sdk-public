import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { findPackageRoot } from '../tui/package-root.js';

const PACKAGE_NAME = '@contentful/experience-design-system-cli';

export function extractWatchFlag(args: string[]): { watch: boolean; rest: string[] } {
  const rest = args.filter((arg) => arg !== '--watch');
  return { watch: rest.length !== args.length, rest };
}

// `experiences import --watch`: hands over to scripts/dev.mjs, which rebuilds dist/ on every save and restarts the
// app. The script is not part of the published package, so this only works from a repo checkout.
export function runDevWatch(args: string[]): Promise<number> {
  const script = join(findPackageRoot(import.meta.url, PACKAGE_NAME), 'scripts', 'dev.mjs');
  if (!existsSync(script)) {
    process.stderr.write('--watch only works from a checkout of the repo (scripts/dev.mjs is not in the package).\n');
    return Promise.resolve(1);
  }

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: 'inherit' });
    // Ctrl+C reaches the whole process group; the runner shuts down cleanly, so this process just waits for it.
    process.on('SIGINT', () => undefined);
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', (err) => {
      process.stderr.write(`${err.message}\n`);
      resolve(1);
    });
  });
}
