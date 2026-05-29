import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
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

/**
 * Write a fake CLI script that appends its argv to args.json and exits 0.
 *
 * When handling 'generate components', the script seeds the DB session so that
 * findLatestSessionForCommand('generate components') returns the expected ID.
 * The session ID is extracted from the configured stdout value (session=<id>).
 */
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

// Seed the DB so the orchestrator can look up session IDs after each step.
if (match.stdout) {
  const sessionMatch = /^session=(.+)$/m.exec(match.stdout);
  const dbPath = process.env.EDS_PIPELINE_DB_PATH;
  if (sessionMatch && dbPath) {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath);
    const id = sessionMatch[1].trim();
    const now = new Date().toISOString();
    db.prepare('INSERT OR IGNORE INTO sessions (id, name, created_at, updated_at) VALUES (?, NULL, ?, ?)').run(id, now, now);
    // Map subcommand to the step command name stored in DB
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
  const { readFile } = await import('node:fs/promises');
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

/**
 * Point EDS_PIPELINE_DB_PATH at a per-test DB so the orchestrator and fake CLI
 * subprocess share the same database instance.  Returns a cleanup function.
 */
function useTestDb(dir: string): () => void {
  const dbPath = join(dir, 'pipeline.db');
  const prev = process.env['EDS_PIPELINE_DB_PATH'];
  process.env['EDS_PIPELINE_DB_PATH'] = dbPath;
  return () => {
    if (prev === undefined) delete process.env['EDS_PIPELINE_DB_PATH'];
    else process.env['EDS_PIPELINE_DB_PATH'] = prev;
  };
}

describe('runPipeline — print step', () => {
  it('omits print components step when opts.print is false', async () => {
    const dir = await makeTempDir('orch-no-print-');

    const cliPath = await makeFakeCli(dir, {
      'analyze extract': { stdout: 'session=test-session-1\n', stderr: 'Extracted 1 component\n' },
      'analyze select': { stderr: 'Accepted: 1  Rejected: 0\n' },
      'generate components': { stdout: 'session=test-session-2\n', stderr: 'Done: 1/1 components\n' },
      'apply push': {
        stdout: JSON.stringify({
          componentTypes: { created: 1, updated: 0, failed: 0 },
          designTokens: { created: 0, updated: 0, failed: 0 },
        }),
      },
    });

    const lines: string[] = [];
    const result = await runPipeline({ ...baseOpts({ out: dir }), project: dir }, (line) => lines.push(line), cliPath);

    expect(result.steps.map((s) => s.step)).not.toContain('print components');
    expect(result.steps.map((s) => s.step)).toContain('apply push');
  });

  it('includes print components step when opts.print is true', async () => {
    const dir = await makeTempDir('orch-with-print-');

    const cliPath = await makeFakeCli(dir, {
      'analyze extract': { stdout: 'session=test-session-1\n', stderr: 'Extracted 1 component\n' },
      'analyze select': { stderr: 'Accepted: 1  Rejected: 0\n' },
      'generate components': { stdout: 'session=test-session-2\n', stderr: 'Done: 1/1 components\n' },
      'print components': {},
      'apply push': {
        stdout: JSON.stringify({
          componentTypes: { created: 1, updated: 0, failed: 0 },
          designTokens: { created: 0, updated: 0, failed: 0 },
        }),
      },
    });

    const lines: string[] = [];
    const result = await runPipeline(
      { ...baseOpts({ out: dir, print: true }), project: dir },
      (line) => lines.push(line),
      cliPath,
    );

    expect(result.steps.map((s) => s.step)).toContain('print components');
  });
});

describe('runPipeline — apply push always gets --yes', () => {
  it('passes --yes to apply push regardless of opts.yes', async () => {
    const dir = await makeTempDir('orch-yes-');

    const cliPath = await makeFakeCli(dir, {
      'analyze extract': { stdout: 'session=test-session-1\n', stderr: 'Extracted 1 component\n' },
      'analyze select': { stderr: 'Accepted: 1  Rejected: 0\n' },
      'generate components': { stdout: 'session=test-session-2\n', stderr: 'Done: 1/1 components\n' },
      'apply push': {
        stdout: JSON.stringify({
          componentTypes: { created: 1, updated: 0, failed: 0 },
          designTokens: { created: 0, updated: 0, failed: 0 },
        }),
      },
    });

    await runPipeline({ ...baseOpts({ out: dir, yes: false }), project: dir }, () => {}, cliPath);

    const calls = await readCalls(dir);
    const pushCall = calls.find((c) => c[0] === 'apply' && c[1] === 'push');
    expect(pushCall).toBeDefined();
    expect(pushCall).toContain('--yes');
  });
});

describe('runPipeline — tokens flag', () => {
  it('passes --tokens to apply push when opts.tokens is set', async () => {
    const dir = await makeTempDir('orch-tokens-');
    const tokensPath = join(dir, 'tokens.json');
    await writeFile(tokensPath, '{}');

    const cliPath = await makeFakeCli(dir, {
      'analyze extract': { stdout: 'session=test-session-1\n', stderr: 'Extracted 1 component\n' },
      'analyze select': { stderr: 'Accepted: 1  Rejected: 0\n' },
      'generate components': { stdout: 'session=test-session-2\n', stderr: 'Done: 1/1 components\n' },
      'apply push': {
        stdout: JSON.stringify({
          componentTypes: { created: 1, updated: 0, failed: 0 },
          designTokens: { created: 1, updated: 0, failed: 0 },
        }),
      },
    });

    await runPipeline({ ...baseOpts({ out: dir, tokens: tokensPath }), project: dir }, () => {}, cliPath);

    const calls = await readCalls(dir);
    const pushCall = calls.find((c) => c[0] === 'apply' && c[1] === 'push');
    expect(pushCall).toBeDefined();
    expect(pushCall).toContain('--tokens');
    expect(pushCall).toContain(tokensPath);
  });

  it('does not pass --tokens when opts.tokens is not set', async () => {
    const dir = await makeTempDir('orch-no-tokens-');

    const cliPath = await makeFakeCli(dir, {
      'analyze extract': { stdout: 'session=test-session-1\n', stderr: 'Extracted 1 component\n' },
      'analyze select': { stderr: 'Accepted: 1  Rejected: 0\n' },
      'generate components': { stdout: 'session=test-session-2\n', stderr: 'Done: 1/1 components\n' },
      'apply push': {
        stdout: JSON.stringify({
          componentTypes: { created: 1, updated: 0, failed: 0 },
          designTokens: { created: 0, updated: 0, failed: 0 },
        }),
      },
    });

    await runPipeline({ ...baseOpts({ out: dir }), project: dir }, () => {}, cliPath);

    const calls = await readCalls(dir);
    const pushCall = calls.find((c) => c[0] === 'apply' && c[1] === 'push');
    expect(pushCall).toBeDefined();
    expect(pushCall).not.toContain('--tokens');
  });
});

describe('runPipeline — step count in progress output', () => {
  it('shows 4 total steps when print is false', async () => {
    const dir = await makeTempDir('orch-4steps-');

    const cliPath = await makeFakeCli(dir, {
      'analyze extract': { stdout: 'session=s1\n', stderr: 'Extracted 1 component\n' },
      'analyze select': { stderr: 'Accepted: 1  Rejected: 0\n' },
      'generate components': { stdout: 'session=s2\n', stderr: 'Done: 1/1 components\n' },
      'apply push': {
        stdout: JSON.stringify({
          componentTypes: { created: 1, updated: 0, failed: 0 },
          designTokens: { created: 0, updated: 0, failed: 0 },
        }),
      },
    });

    const lines: string[] = [];
    await runPipeline({ ...baseOpts({ out: dir }), project: dir }, (line) => lines.push(line), cliPath);

    const stepLines = lines.filter((l) => l.includes('Step '));
    expect(stepLines.every((l) => l.includes('/4'))).toBe(true);
  });

  it('shows 5 total steps when print is true', async () => {
    const dir = await makeTempDir('orch-5steps-');

    const cliPath = await makeFakeCli(dir, {
      'analyze extract': { stdout: 'session=s1\n', stderr: 'Extracted 1 component\n' },
      'analyze select': { stderr: 'Accepted: 1  Rejected: 0\n' },
      'generate components': { stdout: 'session=s2\n', stderr: 'Done: 1/1 components\n' },
      'print components': {},
      'apply push': {
        stdout: JSON.stringify({
          componentTypes: { created: 1, updated: 0, failed: 0 },
          designTokens: { created: 0, updated: 0, failed: 0 },
        }),
      },
    });

    const lines: string[] = [];
    await runPipeline({ ...baseOpts({ out: dir, print: true }), project: dir }, (line) => lines.push(line), cliPath);

    const stepLines = lines.filter((l) => l.includes('Step '));
    expect(stepLines.every((l) => l.includes('/5'))).toBe(true);
  });
});

describe('runPipeline — apply push uses session not components file', () => {
  it('passes --session with extract session ID to apply push', async () => {
    const dir = await makeTempDir('orch-session-push-');
    const restoreDb = useTestDb(dir);

    const cliPath = await makeFakeCli(dir, {
      'analyze extract': { stdout: 'session=extract-session\n', stderr: 'Extracted 1 component\n' },
      'analyze select': { stderr: 'Accepted: 1  Rejected: 0\n' },
      'generate components': { stdout: 'session=extract-session\n', stderr: 'Done: 1/1 components\n' },
      'apply push': {
        stdout: JSON.stringify({
          componentTypes: { created: 1, updated: 0, failed: 0 },
          designTokens: { created: 0, updated: 0, failed: 0 },
        }),
      },
    });

    await runPipeline({ ...baseOpts({ out: dir }), project: dir }, () => {}, cliPath);
    restoreDb();

    const calls = await readCalls(dir);
    const pushCall = calls.find((c) => c[0] === 'apply' && c[1] === 'push');
    expect(pushCall).toBeDefined();
    expect(pushCall).toContain('--session');
    // Components are stored under the extract session, so that's what apply push receives
    expect(pushCall).toContain('extract-session');
    expect(pushCall).not.toContain('--components');
  });
});

describe('runPipeline — verbose flag propagation', () => {
  it('passes --verbose to generate and apply when opts.verbose is true', async () => {
    const dir = await makeTempDir('orch-verbose-');

    const cliPath = await makeFakeCli(dir, {
      'analyze extract': { stdout: 'session=s1\n', stderr: 'Extracted 1 component\n' },
      'analyze select': { stderr: 'Accepted: 1  Rejected: 0\n' },
      'generate components': { stdout: 'session=s2\n', stderr: 'Done: 1/1 components\n' },
      'apply push': {
        stdout: JSON.stringify({
          componentTypes: { created: 1, updated: 0, failed: 0 },
          designTokens: { created: 0, updated: 0, failed: 0 },
        }),
      },
    });

    await runPipeline({ ...baseOpts({ out: dir, verbose: true }), project: dir }, () => {}, cliPath);

    const calls = await readCalls(dir);
    const genCall = calls.find((c) => c[0] === 'generate' && c[1] === 'components');
    const pushCall = calls.find((c) => c[0] === 'apply' && c[1] === 'push');
    expect(genCall).toContain('--verbose');
    expect(pushCall).toContain('--verbose');
  });

  it('does not pass --verbose when opts.verbose is false', async () => {
    const dir = await makeTempDir('orch-no-verbose-');

    const cliPath = await makeFakeCli(dir, {
      'analyze extract': { stdout: 'session=s1\n', stderr: 'Extracted 1 component\n' },
      'analyze select': { stderr: 'Accepted: 1  Rejected: 0\n' },
      'generate components': { stdout: 'session=s2\n', stderr: 'Done: 1/1 components\n' },
      'apply push': {
        stdout: JSON.stringify({
          componentTypes: { created: 1, updated: 0, failed: 0 },
          designTokens: { created: 0, updated: 0, failed: 0 },
        }),
      },
    });

    await runPipeline({ ...baseOpts({ out: dir, verbose: false }), project: dir }, () => {}, cliPath);

    const calls = await readCalls(dir);
    const genCall = calls.find((c) => c[0] === 'generate' && c[1] === 'components');
    const pushCall = calls.find((c) => c[0] === 'apply' && c[1] === 'push');
    expect(genCall).not.toContain('--verbose');
    expect(pushCall).not.toContain('--verbose');
  });
});
