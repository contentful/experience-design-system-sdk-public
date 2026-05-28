#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { symlinkSync, existsSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'packages', 'experience-design-system-cli', 'bin', 'cli.js');

let npmBinDir;
try {
  npmBinDir = execSync('npm bin -g 2>/dev/null || npm prefix -g', { encoding: 'utf8' }).trim();
  if (!npmBinDir.endsWith('bin')) npmBinDir = join(npmBinDir, 'bin');
} catch {
  process.exit(0);
}

if (!existsSync(npmBinDir)) mkdirSync(npmBinDir, { recursive: true });

chmodSync(target, 0o755);

for (const name of ['experiences', 'experience-design-system-cli']) {
  const link = join(npmBinDir, name);
  try { rmSync(link); } catch {}
  try {
    symlinkSync(target, link);
    console.log(`✓ Linked ${name} → ${target}`);
  } catch (e) {
    console.warn(`  Could not link ${name}: ${e.message}`);
  }
}
