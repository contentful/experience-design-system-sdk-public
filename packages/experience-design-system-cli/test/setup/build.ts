import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function setup() {
  // Suppress node:sqlite ExperimentalWarning in CLI child processes spawned by tests
  process.env.NODE_NO_WARNINGS = '1';

  const distIndex = resolve(import.meta.dirname, '../../dist/index.js');
  if (!existsSync(distIndex)) {
    execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], {
      cwd: resolve(import.meta.dirname, '../..'),
      stdio: 'inherit',
    });
  }
}
