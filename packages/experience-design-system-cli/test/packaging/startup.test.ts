import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
let installedRoot: string;
let preload: string;

beforeAll(() => {
  installedRoot = mkdtempSync(join(tmpdir(), 'cli-startup-'));
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  for (const path of ['bin', 'dist', 'skills', 'package.json']) {
    cpSync(join(packageRoot, path), join(installedRoot, path), { recursive: true });
  }
  for (const name of Object.keys(manifest.dependencies)) {
    const destination = join(installedRoot, 'node_modules', name);
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(realpathSync(join(packageRoot, 'node_modules', name)), destination, 'dir');
  }

  preload = join(installedRoot, 'isolated-config.mjs');
  writeFileSync(
    preload,
    "import os from 'node:os';\n" +
      "import { syncBuiltinESMExports } from 'node:module';\n" +
      'os.homedir = () => process.env.EDS_TEST_USER_DIR;\n' +
      'syncBuiltinESMExports();\n',
  );
});

afterAll(() => {
  if (installedRoot) rmSync(installedRoot, { recursive: true, force: true });
});

function runCli(...args: string[]) {
  return spawnSync(process.execPath, ['--import', preload, join(installedRoot, 'bin', 'cli.js'), ...args], {
    cwd: installedRoot,
    encoding: 'utf8',
    timeout: 15000,
    env: {
      ...process.env,
      EDS_HOME: join(installedRoot, 'config'),
      EDS_TEST_USER_DIR: join(installedRoot, 'user'),
    },
  });
}

describe('CLI startup with only declared runtime dependencies', () => {
  it('loads the built CLI and prints its available commands', () => {
    const result = runCli('--help');

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Usage: experiences');
    expect(result.stdout).toContain('import');
  });

  it('reports invalid import options without a module-loading failure', () => {
    const result = runCli('import', '--debug-from', 'review');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('--debug-from and --debug-output require --debug-resume.');
    expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
  });
});
