import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');

// ── Integration: parse-time mutex errors (real CLI) ────────────────────────
//
// These flags should fail *before* we touch pipeline.db, so we can run them
// with an empty environment and no project.

function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((res) => {
    execFile('node', [bin, ...args], { env: { ...process.env } }, (error, stdout, stderr) => {
      res({ stdout, stderr, code: error?.code ? Number(error.code) : 0 });
    });
  });
}

describe('experiences import --push-from-run — parse-time mutex errors', () => {
  it('errors when --push-from-run is combined with --project', async () => {
    const { stderr, code } = await run(['import', '--push-from-run', '01HXYZ', '--project', '/tmp/whatever']);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--push-from-run.*--project|--project.*--push-from-run/);
  });

  it('errors when --push-from-run is combined with --no-save', async () => {
    const { stderr, code } = await run(['import', '--push-from-run', '01HXYZ', '--no-save']);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--push-from-run.*--no-save|--no-save.*--push-from-run/);
  });

  it('errors when --push-from-run is combined with --no-push', async () => {
    const { stderr, code } = await run(['import', '--push-from-run', '01HXYZ', '--no-push']);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--push-from-run.*--no-push|--no-push.*--push-from-run/);
  });

  it('errors when --push-from-run is combined with --modify', async () => {
    const { stderr, code } = await run(['import', '--push-from-run', '01HXYZ', '--modify', '01HXYZ']);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--push-from-run.*--modify|--modify.*--push-from-run/);
  });

  it('errors when --overwrite and --save-as-new are combined under --modify', async () => {
    const { stderr, code } = await run(['import', '--modify', '01HXYZ', '--overwrite', '--save-as-new']);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--overwrite.*--save-as-new|--save-as-new.*--overwrite|mutually exclusive/);
  });

  it('errors when --overwrite is passed without --modify', async () => {
    const { stderr, code } = await run(['import', '--overwrite']);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--overwrite.*--modify|require --modify/);
  });
});

// ── Unit: delegation to replayRun / modifyRun helpers ───────────────────────

const { mockReplayRun, mockModifyRun } = vi.hoisted(() => ({
  mockReplayRun: vi.fn(),
  mockModifyRun: vi.fn(),
}));

vi.mock('../../src/runs/replay-helpers.js', () => ({
  replayRun: mockReplayRun,
  modifyRun: mockModifyRun,
}));

import { Command } from 'commander';
import { registerImportCommand } from '../../src/import/command.js';

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerImportCommand(program);
  return program;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockReplayRun.mockResolvedValue(undefined);
  mockModifyRun.mockResolvedValue(undefined);
});

describe('experiences import --push-from-run — delegation', () => {
  it('calls replayRun with the runIdOrPath positional', async () => {
    const program = buildProgram();
    await program.parseAsync(['import', '--push-from-run', '01HXYZABCDEFGHJKMNPQRSTVWXY'], { from: 'user' });
    expect(mockReplayRun).toHaveBeenCalledWith(expect.objectContaining({ runIdOrPath: '01HXYZABCDEFGHJKMNPQRSTVWXY' }));
    expect(mockModifyRun).not.toHaveBeenCalled();
  });

  it('calls replayRun when --push-from-run resolves a path', async () => {
    const program = buildProgram();
    await program.parseAsync(['import', '--push-from-run', '/tmp/some/savepath'], { from: 'user' });
    expect(mockReplayRun).toHaveBeenCalledWith(expect.objectContaining({ runIdOrPath: '/tmp/some/savepath' }));
  });

  it('warns and ignores composition flags under --push-from-run (still delegates)', async () => {
    const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      const program = buildProgram();
      await program.parseAsync(['import', '--push-from-run', '01HXYZ', '--composite', '--composition-agent'], {
        from: 'user',
      });
      const stderr = warn.mock.calls.map((c) => String(c[0])).join('');
      expect(stderr).toMatch(/--composite/);
      expect(stderr).toMatch(/ignored with --push-from-run/);
      expect(stderr).toMatch(/composition mode comes from the recorded run/);
      expect(mockReplayRun).toHaveBeenCalledWith(expect.objectContaining({ runIdOrPath: '01HXYZ' }));
    } finally {
      warn.mockRestore();
    }
  });

  it('forwards --space-id / --environment-id / --cma-token / --host to replayRun', async () => {
    const program = buildProgram();
    await program.parseAsync(
      [
        'import',
        '--push-from-run',
        '01HXYZ',
        '--space-id',
        'sp-1',
        '--environment-id',
        'env-1',
        '--cma-token',
        'tok-1',
        '--host',
        'api.flinkly.com',
      ],
      { from: 'user' },
    );
    expect(mockReplayRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runIdOrPath: '01HXYZ',
        spaceId: 'sp-1',
        environmentId: 'env-1',
        cmaToken: 'tok-1',
        host: 'api.flinkly.com',
      }),
    );
  });
});

describe('experiences import --force — forwarding', () => {
  it('forwards --force to replayRun under --push-from-run', async () => {
    const program = buildProgram();
    await program.parseAsync(['import', '--push-from-run', '01HXYZ', '--force'], { from: 'user' });
    expect(mockReplayRun).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it('forwards --force to modifyRun under --modify', async () => {
    const program = buildProgram();
    await program.parseAsync(['import', '--modify', '01HXYZ', '--force'], { from: 'user' });
    expect(mockModifyRun).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it('omits force when the flag is absent', async () => {
    const program = buildProgram();
    await program.parseAsync(['import', '--push-from-run', '01HXYZ'], { from: 'user' });
    const call = mockReplayRun.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call['force']).toBeUndefined();
  });
});

describe('experiences import --modify — delegation', () => {
  it('calls modifyRun with the positional', async () => {
    const program = buildProgram();
    await program.parseAsync(['import', '--modify', '01HXYZ'], { from: 'user' });
    expect(mockModifyRun).toHaveBeenCalledWith(expect.objectContaining({ runIdOrPath: '01HXYZ' }));
    expect(mockReplayRun).not.toHaveBeenCalled();
  });

  it('forwards --overwrite to modifyRun', async () => {
    const program = buildProgram();
    await program.parseAsync(['import', '--modify', '01HXYZ', '--overwrite'], { from: 'user' });
    expect(mockModifyRun).toHaveBeenCalledWith(expect.objectContaining({ runIdOrPath: '01HXYZ', overwrite: true }));
  });

  it('forwards --save-as-new to modifyRun', async () => {
    const program = buildProgram();
    await program.parseAsync(['import', '--modify', '01HXYZ', '--save-as-new'], { from: 'user' });
    expect(mockModifyRun).toHaveBeenCalledWith(expect.objectContaining({ runIdOrPath: '01HXYZ', saveAsNew: true }));
  });
});
