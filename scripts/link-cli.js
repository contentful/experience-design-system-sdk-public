#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { symlinkSync, existsSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, isAbsolute } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'packages', 'experience-design-system-cli', 'bin', 'cli.js');

// `npm bin -g` was removed in npm 9+; `npm prefix -g` is the PATH-safe equivalent
// on all supported npm versions.
let npmBinDir;
try {
  const prefix = execSync('npm prefix -g', { encoding: 'utf8' }).trim();
  npmBinDir = join(prefix, 'bin');
} catch {
  process.exit(0);
}

if (npmBinDir.includes('\n') || !isAbsolute(npmBinDir)) process.exit(0);

if (!existsSync(npmBinDir)) mkdirSync(npmBinDir, { recursive: true });

chmodSync(target, 0o755);

for (const name of ['experiences', 'exo', 'experience-design-system-cli']) {
  const link = join(npmBinDir, name);
  try { rmSync(link); } catch {}
  try {
    symlinkSync(target, link);
    console.log(`✓ Linked ${name} → ${target}`);
  } catch (e) {
    console.warn(`  Could not link ${name}: ${e.message}`);
  }
}
