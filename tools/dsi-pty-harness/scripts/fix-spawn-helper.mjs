#!/usr/bin/env node
/**
 * pnpm strips the +x bit from files in packages' `prebuilds/` directories
 * on install, which breaks node-pty (its `spawn-helper` binary must be
 * executable). Restore it here so `pnpm install` alone is enough to run
 * the harness — no manual chmod required.
 */
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
let pkgPath;
try {
  pkgPath = require.resolve('node-pty/package.json');
} catch {
  process.exit(0);
}
const prebuilds = join(dirname(pkgPath), 'prebuilds');
if (!existsSync(prebuilds)) process.exit(0);

for (const arch of readdirSync(prebuilds)) {
  const helper = join(prebuilds, arch, 'spawn-helper');
  if (!existsSync(helper)) continue;
  const mode = statSync(helper).mode;
  if ((mode & 0o111) === 0) {
    chmodSync(helper, mode | 0o755);
  }
}
