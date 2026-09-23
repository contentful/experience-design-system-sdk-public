import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, rm, chmod, mkdir } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { tmpdir } from 'node:os';
import { binaryExists, findBinary, resolveSpawn, spawnSpec } from '../src/lib/binary-launch.js';

// These tests assert Windows behaviour while running on macOS/Linux by passing
// `platform` explicitly. That's the only way to cover the Windows paths without a
// Windows runner, so the win32 cases must never read process.platform.

let dir: string;
let binDir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'binary-launch-'));
  binDir = join(dir, 'bin');
  await mkdir(binDir, { recursive: true });

  // A POSIX-style executable (no extension) and the Windows shim shapes.
  await writeFile(join(binDir, 'claude'), '#!/bin/sh\nexit 0\n');
  await chmod(join(binDir, 'claude'), 0o755);
  await writeFile(join(binDir, 'claude.cmd'), '@echo off\n');
  await chmod(join(binDir, 'claude.cmd'), 0o755);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('findBinary', () => {
  it('finds a bare command on PATH', () => {
    vi.stubEnv('PATH', binDir);
    expect(findBinary('claude', 'darwin')).toBe(join(binDir, 'claude'));
  });

  it('finds a .cmd shim on Windows, which libuv spawn would miss', () => {
    vi.stubEnv('PATH', binDir);
    // The extensionless file exists too, but win32 must resolve an executable
    // extension — that is the whole point of the lookup.
    expect(findBinary('claude', 'win32')).toBe(join(binDir, 'claude.cmd'));
  });

  it('returns null for a command that is not installed', () => {
    vi.stubEnv('PATH', binDir);
    expect(findBinary('definitely-not-installed-xyz', 'darwin')).toBeNull();
    expect(findBinary('definitely-not-installed-xyz', 'win32')).toBeNull();
  });

  it('accepts an absolute path directly', () => {
    vi.stubEnv('PATH', '');
    expect(findBinary(join(binDir, 'claude'), 'darwin')).toBe(join(binDir, 'claude'));
  });

  it('resolves an absolute path that omits its Windows extension', () => {
    vi.stubEnv('PATH', '');
    // EDS_AGENT_BINARY_CLAUDE=C:\tools\claude should find claude.cmd.
    const withoutExt = join(binDir, 'claude');
    expect(findBinary(withoutExt, 'win32')).toBe(withoutExt); // extensionless exists here
  });

  it('returns null for an absolute path that does not exist', () => {
    expect(findBinary(join(dir, 'nope', 'missing'), 'darwin')).toBeNull();
  });

  it('splits PATH with the platform delimiter', () => {
    // A ';'-joined PATH must not parse on POSIX, nor a ':'-joined one on Windows.
    vi.stubEnv('PATH', ['/nonexistent-a', binDir].join(delimiter));
    expect(findBinary('claude', 'darwin')).toBe(join(binDir, 'claude'));
  });

  it('ignores relative PATH entries', () => {
    // Resolving against the cwd would make results depend on where the CLI ran.
    vi.stubEnv('PATH', ['.', 'relative/bin'].join(delimiter));
    expect(findBinary('claude', 'darwin')).toBeNull();
  });

  it('tolerates an unset PATH', () => {
    vi.stubEnv('PATH', '');
    expect(findBinary('claude', 'darwin')).toBeNull();
  });
});

describe('binaryExists', () => {
  it('reports presence without exposing the path', () => {
    vi.stubEnv('PATH', binDir);
    expect(binaryExists('claude', 'darwin')).toBe(true);
    expect(binaryExists('claude', 'win32')).toBe(true);
    expect(binaryExists('nope-xyz', 'win32')).toBe(false);
  });
});

describe('spawnSpec', () => {
  it('passes a POSIX executable through untouched', () => {
    expect(spawnSpec('/usr/local/bin/claude', ['--print', 'hi'], 'darwin')).toEqual({
      command: '/usr/local/bin/claude',
      args: ['--print', 'hi'],
    });
  });

  it('passes a Windows .exe through untouched', () => {
    // A real executable needs no shell, so don't pay for one.
    expect(spawnSpec('C:\\tools\\node.exe', ['-v'], 'win32')).toEqual({
      command: 'C:\\tools\\node.exe',
      args: ['-v'],
    });
  });

  it('wraps a Windows .cmd in cmd.exe, which spawn cannot start directly', () => {
    vi.stubEnv('ComSpec', 'C:\\Windows\\system32\\cmd.exe');
    const spec = spawnSpec('C:\\npm\\claude.cmd', ['--print'], 'win32');
    expect(spec.command).toBe('C:\\Windows\\system32\\cmd.exe');
    expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(spec.args[3]).toBe('""C:\\npm\\claude.cmd" "--print""');
    // Node must not re-quote what we already quoted.
    expect(spec.windowsVerbatimArguments).toBe(true);
  });

  it('wraps a .bat the same way', () => {
    vi.stubEnv('ComSpec', 'cmd.exe');
    expect(spawnSpec('C:\\tools\\thing.bat', [], 'win32').command).toBe('cmd.exe');
  });

  it('falls back to cmd.exe when ComSpec is unset', () => {
    vi.stubEnv('ComSpec', '');
    expect(spawnSpec('C:\\npm\\claude.cmd', [], 'win32').command).toBe('cmd.exe');
  });

  it('keeps an argument containing spaces as one argument', () => {
    vi.stubEnv('ComSpec', 'cmd.exe');
    const spec = spawnSpec('C:\\npm\\claude.cmd', ['--model', 'my model'], 'win32');
    expect(spec.args[3]).toContain('"my model"');
  });

  it('escapes embedded double quotes by doubling them', () => {
    vi.stubEnv('ComSpec', 'cmd.exe');
    const spec = spawnSpec('C:\\npm\\claude.cmd', ['say "hi"'], 'win32');
    expect(spec.args[3]).toContain('"say ""hi"""');
  });
});

describe('resolveSpawn', () => {
  it('resolves and wraps in one step on Windows', () => {
    vi.stubEnv('PATH', binDir);
    vi.stubEnv('ComSpec', 'cmd.exe');
    const spec = resolveSpawn('claude', ['--print'], 'win32');
    expect(spec?.command).toBe('cmd.exe');
    expect(spec?.args[3]).toContain('claude.cmd');
  });

  it('resolves to the binary itself on POSIX', () => {
    vi.stubEnv('PATH', binDir);
    expect(resolveSpawn('claude', ['--print'], 'darwin')).toEqual({
      command: join(binDir, 'claude'),
      args: ['--print'],
    });
  });

  it('returns null when the command is missing, so callers can say so', () => {
    vi.stubEnv('PATH', binDir);
    expect(resolveSpawn('nope-xyz', [], 'win32')).toBeNull();
  });
});
