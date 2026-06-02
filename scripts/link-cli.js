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
  process.stderr.write(
    '  Could not determine global npm bin directory — skipping CLI symlinks.\n' +
    '  Run the CLI directly: node packages/experience-design-system-cli/bin/cli.js --help\n'
  );
  process.exit(0);
}

if (!existsSync(npmBinDir)) mkdirSync(npmBinDir, { recursive: true });

chmodSync(target, 0o755);

let anyFailed = false;
for (const name of ['experiences', 'exo', 'experience-design-system-cli']) {
  const link = join(npmBinDir, name);
  try { rmSync(link); } catch {}
  try {
    symlinkSync(target, link);
    console.log(`✓ Linked ${name} → ${target}`);
  } catch (e) {
    process.stderr.write(`  Could not link ${name}: ${e.message}\n`);
    anyFailed = true;
  }
}

if (anyFailed) {
  process.stderr.write(
    '  One or more symlinks failed. Run the CLI directly instead:\n' +
    '  node packages/experience-design-system-cli/bin/cli.js --help\n'
  );
}
