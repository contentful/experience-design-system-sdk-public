import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { binaryExists, runSpawn } from '../../src/setup/command.js';

// Regression coverage for the `Error: spawn ENOEXEC` support issue: a shim that
// is on PATH with the +x bit but is not loadable (truncated download, saved
// error page, interrupted `npm i -g`). `which` reports success for these, and
// spawn() then throws SYNCHRONOUSLY — which used to escape runSpawn's promise
// entirely and surface as a bare `Error: spawn ENOEXEC` naming no command.

const root = join(tmpdir(), 'eds-spawn-helpers-test');
const brokenDir = join(root, 'broken');
const goodDir = join(root, 'good');
const originalPath = process.env['PATH'];

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

beforeAll(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(brokenDir, { recursive: true });
  mkdirSync(goodDir, { recursive: true });
  writeExecutable(join(brokenDir, 'truncated'), '');
  writeExecutable(join(brokenDir, 'no-shebang'), 'echo hi\n');
  writeExecutable(join(brokenDir, 'html-error-page'), '<!DOCTYPE html>\n<html>404</html>\n');
  writeExecutable(join(goodDir, 'works'), '#!/usr/bin/env node\nconsole.log("10.27.0")\n');
  // Same name in both dirs, broken first — the shadowing that makes a
  // reinstall appear not to help.
  writeExecutable(join(brokenDir, 'shadowed'), '');
  writeExecutable(join(goodDir, 'shadowed'), '#!/usr/bin/env node\nconsole.log("ok")\n');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  process.env['PATH'] = originalPath;
});

describe('runSpawn', () => {
  it('resolves instead of throwing when spawn fails synchronously with ENOEXEC', async () => {
    const result = await runSpawn(join(brokenDir, 'truncated'), ['--version']);
    expect(result.exitCode).toBe(1);
    expect(result.spawnErrorCode).toBe('ENOEXEC');
  });

  it('names the failing command in the ENOEXEC message', async () => {
    const result = await runSpawn(join(brokenDir, 'no-shebang'), ['--version']);
    expect(result.stderr).toContain('could not be started');
    expect(result.stderr).toContain('no-shebang');
  });

  it('suggests `which -a` for a bare command name, where shadowing is possible', async () => {
    process.env['PATH'] = `${brokenDir}:${goodDir}:${originalPath ?? ''}`;
    const result = await runSpawn('shadowed', ['--version']);
    expect(result.spawnErrorCode).toBe('ENOEXEC');
    expect(result.stderr).toContain('which -a shadowed');
    expect(result.stderr).toContain('hash -r');
  });

  it('omits the `which -a` hint for an absolute path, where it would not help', async () => {
    const result = await runSpawn(join(brokenDir, 'truncated'), ['--version']);
    expect(result.stderr).not.toContain('which -a');
  });

  it('reports a missing binary as ENOENT, distinct from a corrupt one', async () => {
    const result = await runSpawn(join(brokenDir, 'does-not-exist'), []);
    expect(result.spawnErrorCode).toBe('ENOENT');
    expect(result.stderr).toContain('not found on your PATH');
  });

  it('leaves spawnErrorCode unset when the process ran and merely exited non-zero', async () => {
    const result = await runSpawn(process.execPath, ['-e', 'process.exit(3)']);
    expect(result.exitCode).toBe(3);
    expect(result.spawnErrorCode).toBeUndefined();
  });

  it('captures stdout from a working binary', async () => {
    const result = await runSpawn(join(goodDir, 'works'), []);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('10.27.0');
  });
});

describe('binaryExists', () => {
  it('returns false for a resolvable but unloadable shim', async () => {
    process.env['PATH'] = `${brokenDir}:${originalPath ?? ''}`;
    await expect(binaryExists('truncated')).resolves.toBe(false);
    await expect(binaryExists('html-error-page')).resolves.toBe(false);
  });

  it('returns false when a broken copy shadows a working one earlier on PATH', async () => {
    process.env['PATH'] = `${brokenDir}:${goodDir}:${originalPath ?? ''}`;
    await expect(binaryExists('shadowed')).resolves.toBe(false);
  });

  it('returns true for a valid shebang script', async () => {
    process.env['PATH'] = `${goodDir}:${originalPath ?? ''}`;
    await expect(binaryExists('works')).resolves.toBe(true);
  });

  it('returns false when the name is not on PATH at all', async () => {
    process.env['PATH'] = `${goodDir}:${originalPath ?? ''}`;
    await expect(binaryExists('definitely-not-installed-xyz')).resolves.toBe(false);
  });
});
