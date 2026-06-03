import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function setup() {
  // Suppress node:sqlite ExperimentalWarning in CLI child processes spawned by tests
  process.env.NODE_NO_WARNINGS = '1';

  const packageRoot = resolve(import.meta.dirname, '../..');
  const distEntry = resolve(import.meta.dirname, '../../dist/src/index.js');
  const distPackageJson = resolve(import.meta.dirname, '../../dist/package.json');

  if (!existsSync(distEntry) || !existsSync(distPackageJson)) {
    execFileSync('pnpm', ['build'], {
      cwd: packageRoot,
      stdio: 'inherit',
    });
  }
}
