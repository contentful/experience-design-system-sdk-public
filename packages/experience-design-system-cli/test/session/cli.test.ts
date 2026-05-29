import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { openPipelineDb, getOrCreateSession, createStep, updateStep } from '../../src/session/db.js';

const bin = resolve(import.meta.dirname, '../../bin/cli.js');
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function withTempDb(): Promise<{ dbPath: string; reviewsDir: string; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'session-cli-test-'));
  tempDirs.push(dir);
  const reviewsDir = join(dir, 'reviews');
  return { dbPath: join(dir, 'pipeline.db'), reviewsDir, dir };
}

async function run(
  args: string[],
  dbPath?: string,
  reviewsDir?: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (dbPath) env.EDS_PIPELINE_DB_PATH = dbPath;
  if (reviewsDir) env.EDS_REVIEW_ARTIFACTS_DIR = reviewsDir;

  return new Promise((res) => {
    execFile('node', [bin, ...args], { env }, (error, stdout, stderr) => {
      res({ stdout, stderr, code: error?.code ? Number(error.code) : 0 });
    });
  });
}

describe('session list', () => {
  it('empty DB: exits 0 and prints "No sessions found"', async () => {
    const { dbPath, reviewsDir } = await withTempDb();
    const { stdout, code } = await run(['session', 'list'], dbPath, reviewsDir);
    expect(code).toBe(0);
    expect(stdout).toContain('No sessions');
  });

  it('one session: appears in --json output', async () => {
    const { dbPath, reviewsDir } = await withTempDb();
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze select' });
    db.close();

    const { stdout, code } = await run(['session', 'list', '--json'], dbPath, reviewsDir);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as Array<{ id: string }>;
    expect(parsed.some((s) => s.id === sessionId)).toBe(true);
  });
});

describe('session show', () => {
  it('known ID: shows session and steps in JSON', async () => {
    const { dbPath, reviewsDir } = await withTempDb();
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze select' });
    const stepId = createStep(db, sessionId, 'analyze select', { rawComponents: '/tmp/raw.json' });
    updateStep(db, stepId, 'complete', { refinedComponents: '/tmp/refined.json' });
    db.close();

    const { stdout, code } = await run(['session', 'show', sessionId, '--json'], dbPath, reviewsDir);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { id: string; steps: Array<{ command: string; status: string }> };
    expect(parsed.id).toBe(sessionId);
    expect(parsed.steps[0].command).toBe('analyze select');
    expect(parsed.steps[0].status).toBe('complete');
  });

  it('unknown ID: exits 1 with error', async () => {
    const { dbPath, reviewsDir } = await withTempDb();
    const { stderr, code } = await run(['session', 'show', 'no-such-id'], dbPath, reviewsDir);
    expect(code).toBe(1);
    expect(stderr).toContain("session 'no-such-id' not found");
  });
});

describe('session stats', () => {
  it('empty DB: exits 0, all counts 0', async () => {
    const { dbPath, reviewsDir } = await withTempDb();
    const { stdout, code } = await run(['session', 'stats', '--json'], dbPath, reviewsDir);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { sessions: { total: number }; steps: number };
    expect(parsed.sessions.total).toBe(0);
    expect(parsed.steps).toBe(0);
  });

  it('populated DB: counts match inserted rows', async () => {
    const { dbPath, reviewsDir } = await withTempDb();
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze select' });
    const stepId = createStep(db, sessionId, 'analyze select', {});
    updateStep(db, stepId, 'complete', {});
    db.close();

    const { stdout, code } = await run(['session', 'stats', '--json'], dbPath, reviewsDir);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { sessions: { total: number; complete: number }; steps: number };
    expect(parsed.sessions.total).toBe(1);
    expect(parsed.sessions.complete).toBe(1);
    expect(parsed.steps).toBe(1);
  });

  it('TTY output includes "session prune" hint', async () => {
    const { dbPath, reviewsDir } = await withTempDb();
    // Force non-JSON (pipe) output that contains the hint
    const { stdout } = await run(['session', 'stats'], dbPath, reviewsDir);
    expect(stdout).toContain('session prune');
  });
});

describe('session prune', () => {
  it('--id: deletes session and session list no longer shows it', async () => {
    const { dbPath, reviewsDir } = await withTempDb();
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze select' });
    db.close();

    const { code } = await run(['session', 'prune', '--id', sessionId, '--yes'], dbPath, reviewsDir);
    expect(code).toBe(0);

    const { stdout } = await run(['session', 'list', '--json'], dbPath, reviewsDir);
    const parsed = JSON.parse(stdout) as Array<{ id: string }>;
    expect(parsed.some((s) => s.id === sessionId)).toBe(false);
  });

  it('no filters: exits 1 with "no filter specified" error', async () => {
    const { dbPath, reviewsDir } = await withTempDb();
    const { stderr, code } = await run(['session', 'prune'], dbPath, reviewsDir);
    expect(code).toBe(1);
    expect(stderr).toContain('at least one of --id, --older-than, or --status is required');
  });

  it('--dry-run: prints what would be deleted without deleting', async () => {
    const { dbPath, reviewsDir } = await withTempDb();
    const db = openPipelineDb(dbPath);
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze select' });
    db.close();

    const { stdout, code } = await run(['session', 'prune', '--id', sessionId, '--dry-run'], dbPath, reviewsDir);
    expect(code).toBe(0);
    expect(stdout).toContain('Would delete');
    expect(stdout).toContain(sessionId);

    // Session still exists
    const { stdout: listOut } = await run(['session', 'list', '--json'], dbPath, reviewsDir);
    const parsed = JSON.parse(listOut) as Array<{ id: string }>;
    expect(parsed.some((s) => s.id === sessionId)).toBe(true);
  });
});
