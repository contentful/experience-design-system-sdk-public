import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openPipelineDb, loadRawComponents } from '../src/session/db.js';

const bin = resolve(import.meta.dirname, '../bin/cli.js');
const tempDirs: string[] = [];

function run(...args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile('node', [bin, ...args], (error, stdout, stderr) => {
      resolve({ stdout, stderr, code: error?.code ? Number(error.code) : 0 });
    });
  });
}

function runWithEnv(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    execFile('node', [bin, ...args], { env }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, code: error?.code ? Number(error.code) : 0 });
    });
  });
}

async function createTempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('CLI entry point', () => {
  it('prints help with --help', async () => {
    const { stdout, code } = await run('--help');
    expect(code).toBe(0);
    expect(stdout).toContain('experience-design-system-cli');
    expect(stdout).toContain('analyze');
    expect(stdout).toContain('print');
  });

  it('exits with error for unknown commands', async () => {
    const { stderr, code } = await run('nonexistent');
    expect(code).not.toBe(0);
    expect(stderr).toContain("unknown command 'nonexistent'");
  });

  describe('analyze', () => {
    const fixtures = resolve(import.meta.dirname, 'fixtures/analyze');

    it('prints help with --help', async () => {
      const { stdout, code } = await run('analyze', 'extract', '--help');
      expect(code).toBe(0);
      expect(stdout).toContain('--project <path>');
      expect(stdout).toContain('--dir <path>');
      expect(stdout).not.toContain('--out <path>');
    });

    it('extracts React components and stores them in the pipeline DB', async () => {
      const dbDir = await createTempDir('analyze-db-');
      const dbPath = join(dbDir, 'pipeline.db');
      const projectRoot = resolve(fixtures, 'project');

      const { stdout, stderr, code } = await runWithEnv(['analyze', 'extract', '--project', projectRoot], {
        ...process.env,
        EDS_PIPELINE_DB_PATH: dbPath,
      });

      expect(code).toBe(0);
      expect(stderr).toContain('Extracted 1 component');
      expect(stderr).toContain('Scanned');
      expect(stdout).toMatch(/session=[a-z0-9-]+/);

      const sessionMatch = /session=([^\s]+)/.exec(stdout);
      expect(sessionMatch).not.toBeNull();
      const sessionId = sessionMatch![1]!;

      const db = openPipelineDb(dbPath);
      const components = loadRawComponents(db, sessionId);
      db.close();

      expect(components).toHaveLength(1);
      expect(components[0]?.name).toBe('Button');
      expect(components[0]?.framework).toBe('react');
      expect(components[0]?.props.map((p) => p.name)).toContain('variant');
    });

    it('uses --dir to scan a subdirectory other than src/', async () => {
      const dbDir = await createTempDir('analyze-dir-db-');
      const dbPath = join(dbDir, 'pipeline.db');
      const projectRoot = resolve(fixtures, 'flat-project');

      const { stdout, stderr, code } = await runWithEnv(
        ['analyze', 'extract', '--project', projectRoot, '--dir', 'components'],
        { ...process.env, NODE_ENV: 'test', EDS_PIPELINE_DB_PATH: dbPath },
      );

      expect(code).toBe(0);
      expect(stderr).toContain('Extracted 1 component');
      expect(stdout).toMatch(/session=[a-z0-9-]+/);

      const sessionMatch = /session=([^\s]+)/.exec(stdout);
      expect(sessionMatch).not.toBeNull();
      const sessionId = sessionMatch![1]!;

      const db = openPipelineDb(dbPath);
      const components = loadRawComponents(db, sessionId);
      db.close();
      expect(components[0]?.name).toBe('Icon');
    });

    it('falls back to project root when no src/ subdir exists and --dir is omitted', async () => {
      const dbDir = await createTempDir('analyze-fallback-db-');
      const dbPath = join(dbDir, 'pipeline.db');
      // flat-project has no src/ directory — components sit under components/
      const projectRoot = resolve(fixtures, 'flat-project');

      const { stderr, code } = await runWithEnv(['analyze', 'extract', '--project', projectRoot], {
        ...process.env,
        NODE_ENV: 'test',
        EDS_PIPELINE_DB_PATH: dbPath,
      });

      // Should not error; it scans the root and finds the component
      expect(code).toBe(0);
      expect(stderr).toContain('Extracted 1 component');
    });

    it('exits with error when explicit --dir does not exist', async () => {
      const projectRoot = resolve(fixtures, 'project');

      const { stderr, code } = await run(
        'analyze',
        'extract',
        '--project',
        projectRoot,
        '--dir',
        'packages/components/src/components',
      );

      expect(code).toBe(1);
      expect(stderr).toContain('Error: source directory does not exist');
      expect(stderr).toContain('packages/components/src/components');
    });

    it('works when the project path contains spaces', async () => {
      // Reproduces a bug where paths with spaces were percent-encoded (%20) when
      // derived from import.meta.url via url.pathname, causing MODULE_NOT_FOUND
      const base = await createTempDir('analyze-spaces-');
      const projectRoot = join(base, 'my project with spaces');
      const dbDir = await createTempDir('analyze-spaces-db-');
      const dbPath = join(dbDir, 'pipeline.db');

      await mkdir(join(projectRoot, 'src'), { recursive: true });
      await cp(resolve(fixtures, 'project/src/Button.tsx'), join(projectRoot, 'src/Button.tsx'));

      const { stdout, stderr, code } = await runWithEnv(['analyze', 'extract', '--project', projectRoot], {
        ...process.env,
        NODE_ENV: 'test',
        EDS_PIPELINE_DB_PATH: dbPath,
      });

      expect(code).toBe(0);
      expect(stderr).toContain('Extracted 1 component');
      expect(stdout).toMatch(/session=[a-z0-9-]+/);
    });
  });

  describe('print validate', () => {
    const fixtures = resolve(import.meta.dirname, 'fixtures');

    it('prints help with --help', async () => {
      const { stdout, code } = await run('print', 'validate', '--help');
      expect(code).toBe(0);
      expect(stdout).toContain('--components <path>');
      expect(stdout).toContain('--tokens <path>');
    });

    it('exits with code 1 when no flags provided', async () => {
      const { stderr, code } = await run('print', 'validate');
      expect(code).toBe(1);
      expect(stderr).toContain('--components');
      expect(stderr).toContain('--tokens');
    });

    it('exits 0 for valid components file', async () => {
      const { stdout, code } = await run(
        'print',
        'validate',
        '--components',
        resolve(fixtures, 'valid-components.json'),
      );
      expect(code).toBe(0);
      expect(stdout).toContain('✓');
      expect(stdout).toMatch(/2 component/);
    });

    it('exits 1 for invalid components file', async () => {
      const { stdout, code } = await run(
        'print',
        'validate',
        '--components',
        resolve(fixtures, 'invalid-components.json'),
      );
      expect(code).toBe(1);
      expect(stdout).toContain('✗');
      expect(stdout).toMatch(/\d+\./);
    });

    it('exits 0 for valid tokens file', async () => {
      const { stdout, code } = await run('print', 'validate', '--tokens', resolve(fixtures, 'valid-tokens.json'));
      expect(code).toBe(0);
      expect(stdout).toContain('✓');
      expect(stdout).toMatch(/3 token/);
    });

    it('exits 1 for invalid tokens file', async () => {
      const { stdout, code } = await run('print', 'validate', '--tokens', resolve(fixtures, 'invalid-tokens.json'));
      expect(code).toBe(1);
      expect(stdout).toContain('✗');
    });

    it('exits 0 when both flags pass', async () => {
      const { stdout, code } = await run(
        'print',
        'validate',
        '--components',
        resolve(fixtures, 'valid-components.json'),
        '--tokens',
        resolve(fixtures, 'valid-tokens.json'),
      );
      expect(code).toBe(0);
      expect(stdout).toContain('✓');
    });

    it('exits 1 when one flag fails', async () => {
      const { stdout, code } = await run(
        'print',
        'validate',
        '--components',
        resolve(fixtures, 'valid-components.json'),
        '--tokens',
        resolve(fixtures, 'invalid-tokens.json'),
      );
      expect(code).toBe(1);
      expect(stdout).toContain('✓');
      expect(stdout).toContain('✗');
    });

    it('exits 1 for non-existent file', async () => {
      const { stdout, code } = await run('print', 'validate', '--components', resolve(fixtures, 'does-not-exist.json'));
      expect(code).toBe(1);
      expect(stdout).toContain('ENOENT');
    });
  });

  describe('doctor', () => {
    it('prints help with --help', async () => {
      const { stdout, code } = await run('doctor', '--help');
      expect(code).toBe(0);
      expect(stdout).toContain('--skip-build');
      expect(stdout).toContain('--skip-agent');
    });

    it('checks Node.js version and prints result on stdout', async () => {
      const { stdout, code } = await run('doctor', '--skip-build', '--skip-agent');
      expect(stdout).toContain('Node.js');
      expect(code === 0 || stdout.includes('need v24+')).toBe(true);
    });

    it('skips install and build with --skip-build', async () => {
      const { stdout } = await run('doctor', '--skip-build', '--skip-agent');
      const nodeMajor = parseInt(process.versions.node.split('.')[0]!, 10);
      if (nodeMajor >= 24) {
        expect(stdout).toContain('Skipping install + build');
        expect(stdout).not.toContain('pnpm install');
      } else {
        expect(stdout).toContain('need v24+');
      }
    });
  });

  describe('setup', () => {
    it('prints help with --help', async () => {
      const { stdout, code } = await run('setup', '--help');
      expect(code).toBe(0);
      expect(stdout).toContain('--skip-build');
      expect(stdout).toContain('--skip-credentials');
      expect(stdout).toContain('--skip-optional');
    });

    it('checks Node.js version and prints result on stdout', async () => {
      const { stdout, code } = await run(
        'setup',
        '--skip-build',
        '--skip-agent',
        '--skip-credentials',
        '--skip-optional',
      );
      expect(stdout).toContain('Node.js');
      expect(code === 0 || stdout.includes('need v24+')).toBe(true);
    });

    it('exits 0 when all required steps pass with all skips', async () => {
      const { stdout, code } = await run(
        'setup',
        '--skip-build',
        '--skip-agent',
        '--skip-credentials',
        '--skip-optional',
      );
      const nodeMajor = parseInt(process.versions.node.split('.')[0]!, 10);
      if (nodeMajor >= 24) {
        expect(code).toBe(0);
        expect(stdout).toContain('Node.js');
      }
    });

    it('skips install and build steps with --skip-build', async () => {
      const { stdout } = await run('setup', '--skip-build', '--skip-agent', '--skip-credentials', '--skip-optional');
      const nodeMajor = parseInt(process.versions.node.split('.')[0]!, 10);
      if (nodeMajor >= 24) {
        expect(stdout).toContain('Skipping install + build');
        expect(stdout).not.toContain('pnpm install');
        expect(stdout).not.toContain('Building CLI');
      } else {
        expect(stdout).toContain('need v24+');
      }
    });

    it('skips credentials step with --skip-credentials', async () => {
      const { stdout } = await run('setup', '--skip-build', '--skip-agent', '--skip-credentials', '--skip-optional');
      expect(stdout).not.toContain('CMA token');
      expect(stdout).not.toContain('Space ID');
    });
  });
});
