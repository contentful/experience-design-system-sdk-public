#!/usr/bin/env node
/**
 * Run a command, unless we're in CI.
 *
 * Replaces the shell idiom `[ -n "$CI" ] || <command>`, which is valid in bash but
 * not in cmd.exe — Windows has no `[`, so pnpm's lifecycle scripts failed there
 * before doing anything. That made `pnpm install` fail on the first command in
 * the README.
 *
 * Usage: node scripts/run-unless-ci.mjs <command> [args...]
 */
import { spawn } from 'node:child_process';
import { delimiter, isAbsolute, join } from 'node:path';
import { accessSync, constants } from 'node:fs';

if (process.env.CI) process.exit(0);

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('run-unless-ci: no command given');
  process.exit(1);
}

/**
 * Resolve `name` on PATH. Windows installs package binaries as `.cmd` shims, and
 * spawn can neither find them (it ignores PATHEXT) nor start them directly, so
 * find the real file and route a shim through cmd.exe.
 */
function resolveOnPath(name) {
  const extensions = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  if (isAbsolute(name)) return name;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    for (const ext of extensions) {
      const candidate = join(dir, name + ext);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }
  return name;
}

const resolved = resolveOnPath(command);
const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved);
const child = needsShell
  ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[resolved, ...args].map((a) => `"${a}"`).join(' ')}"`], {
      stdio: 'inherit',
      windowsVerbatimArguments: true,
    })
  : spawn(resolved, args, { stdio: 'inherit' });

// A missing optional tool shouldn't fail the install — this stands in for `||`,
// which silently skipped the command when it wasn't available.
child.on('error', () => process.exit(0));
child.on('exit', (code) => process.exit(code ?? 0));
