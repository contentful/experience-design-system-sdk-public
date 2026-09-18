import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSpawn, setupPnpm, verifyPnpm } from '../../src/setup/command.js';

describe('setup spawn handling', () => {
  it('resolves a synchronous ENOEXEC as a failed spawn result', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'experiences-spawn-'));
    const command = join(directory, 'invalid-executable');
    await writeFile(command, 'not a loadable executable');
    await chmod(command, 0o755);

    const result = await runSpawn(command, []);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('ENOEXEC');
  });

  it('does not report an unloadable pnpm as installed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'experiences-pnpm-'));
    const pnpm = join(directory, 'pnpm');
    await writeFile(pnpm, 'not a loadable executable');
    await chmod(pnpm, 0o755);

    const originalPath = process.env['PATH'];
    process.env['PATH'] = `${directory}:${originalPath ?? ''}`;
    try {
      await expect(setupPnpm()).resolves.toBe(false);
    } finally {
      process.env['PATH'] = originalPath;
    }
  });

  it('confirms pnpm is runnable after installation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'experiences-pnpm-'));
    const pnpm = join(directory, 'pnpm');
    await writeFile(pnpm, '#!/bin/sh\nprintf "10.0.0\\n"\n');
    await chmod(pnpm, 0o755);

    const originalPath = process.env['PATH'];
    process.env['PATH'] = `${directory}:${originalPath ?? ''}`;
    try {
      await expect(verifyPnpm()).resolves.toBe(true);
    } finally {
      process.env['PATH'] = originalPath;
    }
  });
});
