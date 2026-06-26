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

describe('experiences import --from-run — parse-time mutex errors', () => {
  it('errors when --from-run is combined with --project', async () => {
    const { stderr, code } = await run([
      'import',
      '--from-run',
      '01HXYZ',
      '--project',
      '/tmp/whatever',
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--from-run.*--project|--project.*--from-run/);
  });

  it('errors when --from-run is combined with --no-save', async () => {
    const { stderr, code } = await run(['import', '--from-run', '01HXYZ', '--no-save']);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--from-run.*--no-save|--no-save.*--from-run/);
  });

  it('errors when --overwrite and --save-as-new are combined', async () => {
    const { stderr, code } = await run([
      'import',
      '--from-run',
      '01HXYZ',
      '--modify',
      '--overwrite',
      '--save-as-new',
    ]);
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--overwrite.*--save-as-new|--save-as-new.*--overwrite|mutually exclusive/);
  });

});

// ── Unit: --from-run delegates to replayRun / modifyRun helpers ────────────

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

describe('experiences import --from-run — delegation', () => {
  it('calls replayRun when --from-run is set with a ulid (no --modify)', async () => {
    const program = buildProgram();
    await program.parseAsync(
      ['import', '--from-run', '01HXYZABCDEFGHJKMNPQRSTVWXY'],
      { from: 'user' },
    );
    expect(mockReplayRun).toHaveBeenCalledWith(
      expect.objectContaining({ runIdOrPath: '01HXYZABCDEFGHJKMNPQRSTVWXY' }),
    );
    expect(mockModifyRun).not.toHaveBeenCalled();
  });

  it('calls replayRun when --from-run resolves a path', async () => {
    const program = buildProgram();
    await program.parseAsync(
      ['import', '--from-run', '/tmp/some/savepath'],
      { from: 'user' },
    );
    expect(mockReplayRun).toHaveBeenCalledWith(
      expect.objectContaining({ runIdOrPath: '/tmp/some/savepath' }),
    );
  });

  it('forwards --out-dir to replayRun', async () => {
    const program = buildProgram();
    await program.parseAsync(
      ['import', '--from-run', '01HXYZ', '--out-dir', '/elsewhere'],
      { from: 'user' },
    );
    expect(mockReplayRun).toHaveBeenCalledWith(
      expect.objectContaining({ runIdOrPath: '01HXYZ', outDir: '/elsewhere' }),
    );
  });

  it('calls modifyRun when --from-run --modify is set', async () => {
    const program = buildProgram();
    await program.parseAsync(
      ['import', '--from-run', '01HXYZ', '--modify'],
      { from: 'user' },
    );
    expect(mockModifyRun).toHaveBeenCalledWith(
      expect.objectContaining({ runIdOrPath: '01HXYZ' }),
    );
    expect(mockReplayRun).not.toHaveBeenCalled();
  });

  it('forwards --overwrite to modifyRun', async () => {
    const program = buildProgram();
    await program.parseAsync(
      ['import', '--from-run', '01HXYZ', '--modify', '--overwrite'],
      { from: 'user' },
    );
    expect(mockModifyRun).toHaveBeenCalledWith(
      expect.objectContaining({ runIdOrPath: '01HXYZ', overwrite: true }),
    );
  });

  it('forwards --save-as-new to modifyRun', async () => {
    const program = buildProgram();
    await program.parseAsync(
      ['import', '--from-run', '01HXYZ', '--modify', '--save-as-new'],
      { from: 'user' },
    );
    expect(mockModifyRun).toHaveBeenCalledWith(
      expect.objectContaining({ runIdOrPath: '01HXYZ', saveAsNew: true }),
    );
  });
});
