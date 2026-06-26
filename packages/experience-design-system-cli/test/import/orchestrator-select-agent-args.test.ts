import { mkdtemp, rm, writeFile, chmod, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, it, expect } from 'vitest';
import { runPipeline } from '../../src/import/orchestrator.js';
import type { PipelineOptions } from '../../src/import/orchestrator.js';

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function makeFakeCli(
  dir: string,
  steps: Record<string, { stdout?: string; stderr?: string; exitCode?: number }>,
): Promise<string> {
  const stepsJson = JSON.stringify(steps);
  const script = `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const subcommand = args.slice(0, 2).join(' ');

const steps = ${stepsJson};
const match = steps[subcommand] ?? steps['*'] ?? { exitCode: 0 };

const argsFile = path.join(${JSON.stringify(dir)}, 'calls.json');
let calls = [];
try { calls = JSON.parse(fs.readFileSync(argsFile, 'utf8')); } catch {}
calls.push(args);
fs.writeFileSync(argsFile, JSON.stringify(calls, null, 2));

if (match.stdout) {
  const sessionMatch = /^session=(.+)$/m.exec(match.stdout);
  const dbPath = process.env.EDS_PIPELINE_DB_PATH;
  if (sessionMatch && dbPath) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const id = sessionMatch[1].trim();
    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO sessions (id, name, created_at, updated_at) VALUES (?, NULL, ?, ?)').run(id, now, now);
    const cmd = subcommand === 'generate components' ? 'generate components' : subcommand === 'analyze extract' ? 'analyze extract' : null;
    if (cmd) {
      db.prepare("INSERT INTO steps (session_id, command, status, started_at, completed_at, updated_at, inputs, outputs) VALUES (?, ?, 'complete', ?, ?, ?, '{}', '{}')").run(
        id, cmd, now, now, now
      );
    }
    db.close();
  }
}

if (match.stdout) process.stdout.write(match.stdout);
if (match.stderr) process.stderr.write(match.stderr);
process.exit(match.exitCode ?? 0);
`;
  const cliPath = join(dir, 'cli.js');
  await writeFile(cliPath, script);
  await chmod(cliPath, 0o755);
  return cliPath;
}

async function readCalls(dir: string): Promise<string[][]> {
  const argsFile = join(dir, 'calls.json');
  try {
    return JSON.parse(await readFile(argsFile, 'utf8')) as string[][];
  } catch {
    return [];
  }
}

function baseOpts(overrides: Partial<PipelineOptions> = {}): PipelineOptions {
  return {
    project: '/fake/project',
    out: '/fake/out',
    spaceId: 'space1',
    environmentId: 'env1',
    cmaToken: 'token1',
    agent: 'claude',
    skipAnalyze: false,
    skipGenerate: false,
    print: false,
    skipApply: false,
    noCache: false,
    yes: false,
    verbose: false,
    ...overrides,
  };
}

function useTestDb(dir: string): () => void {
  const dbPath = join(dir, 'pipeline.db');
  const prev = process.env['EDS_PIPELINE_DB_PATH'];
  process.env['EDS_PIPELINE_DB_PATH'] = dbPath;
  return () => {
    if (prev === undefined) delete process.env['EDS_PIPELINE_DB_PATH'];
    else process.env['EDS_PIPELINE_DB_PATH'] = prev;
  };
}

describe('runPipeline — select-agent argv forwarding', () => {
  it('forwards --no-cache to the spawned analyze select-agent', async () => {
    const dir = await makeTempDir('orch-no-cache-');
    const cleanup = useTestDb(dir);
    try {
      const cliPath = await makeFakeCli(dir, {
        'analyze extract': { stdout: 'session=s-extract\n' },
        'analyze select-agent': { stderr: 'Accepted: 1  Rejected: 0\n' },
        'generate components': { stdout: 'session=s-gen\n' },
        'apply push': {
          stdout: JSON.stringify({
            componentTypes: { created: 1, updated: 0, failed: 0 },
            designTokens: { created: 0, updated: 0, failed: 0 },
          }),
        },
      });

      await runPipeline(
        { ...baseOpts({ out: dir, noCache: true }), project: dir },
        () => {},
        cliPath,
      );

      const calls = await readCalls(dir);
      const selectAgentCall = calls.find((c) => c[0] === 'analyze' && c[1] === 'select-agent');
      expect(selectAgentCall).toBeDefined();
      expect(selectAgentCall).toContain('--no-cache');
    } finally {
      cleanup();
    }
  });

  it('omits --no-cache when opts.noCache is false', async () => {
    const dir = await makeTempDir('orch-cache-on-');
    const cleanup = useTestDb(dir);
    try {
      const cliPath = await makeFakeCli(dir, {
        'analyze extract': { stdout: 'session=s-extract\n' },
        'analyze select-agent': { stderr: 'Accepted: 1  Rejected: 0\n' },
        'generate components': { stdout: 'session=s-gen\n' },
        'apply push': {
          stdout: JSON.stringify({
            componentTypes: { created: 1, updated: 0, failed: 0 },
            designTokens: { created: 0, updated: 0, failed: 0 },
          }),
        },
      });

      await runPipeline(
        { ...baseOpts({ out: dir, noCache: false }), project: dir },
        () => {},
        cliPath,
      );

      const calls = await readCalls(dir);
      const selectAgentCall = calls.find((c) => c[0] === 'analyze' && c[1] === 'select-agent');
      expect(selectAgentCall).toBeDefined();
      expect(selectAgentCall).not.toContain('--no-cache');
    } finally {
      cleanup();
    }
  });

  it('forwards --select-prompt-path <path> to the spawned analyze select-agent', async () => {
    const dir = await makeTempDir('orch-select-prompt-');
    const cleanup = useTestDb(dir);
    try {
      const cliPath = await makeFakeCli(dir, {
        'analyze extract': { stdout: 'session=s-extract\n' },
        'analyze select-agent': { stderr: 'Accepted: 1  Rejected: 0\n' },
        'generate components': { stdout: 'session=s-gen\n' },
        'apply push': {
          stdout: JSON.stringify({
            componentTypes: { created: 1, updated: 0, failed: 0 },
            designTokens: { created: 0, updated: 0, failed: 0 },
          }),
        },
      });

      await runPipeline(
        {
          ...baseOpts({ out: dir, selectPromptPath: '/tmp/custom-select.md' }),
          project: dir,
        },
        () => {},
        cliPath,
      );

      const calls = await readCalls(dir);
      const selectAgentCall = calls.find((c) => c[0] === 'analyze' && c[1] === 'select-agent');
      expect(selectAgentCall).toBeDefined();
      const idx = selectAgentCall!.indexOf('--select-prompt-path');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(selectAgentCall![idx + 1]).toBe('/tmp/custom-select.md');
    } finally {
      cleanup();
    }
  });
});
