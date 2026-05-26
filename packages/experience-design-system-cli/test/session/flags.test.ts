import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli, runCliWithEnv } from '../helpers/cli-runner.js';
import { createTestFixture, type TestFixture } from '../helpers/fixtures.js';

describe('session command — flag variations', () => {
  let fixture: TestFixture;

  beforeAll(async () => {
    fixture = await createTestFixture();
  });
  afterAll(async () => {
    await fixture.cleanup();
  });

  const baseEnv = () => ({
    EDS_PIPELINE_DB_PATH: fixture.dbPath,
    NODE_NO_WARNINGS: '1',
  });

  it('prints help with --help', async () => {
    const { stdout, code } = await runCli(['session', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('session');
  });

  it('session list shows the seeded session', async () => {
    const { stdout, code } = await runCliWithEnv(['session', 'list', '--json'], baseEnv());
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as Array<{ id: string }>;
    expect(parsed.some((s) => s.id === fixture.sessionId)).toBe(true);
  });

  it('session show retrieves session details', async () => {
    const { stdout, code } = await runCliWithEnv(['session', 'show', fixture.sessionId, '--json'], baseEnv());
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { id: string };
    expect(parsed.id).toBe(fixture.sessionId);
  });

  it('session show fails for nonexistent session', async () => {
    const { code } = await runCliWithEnv(['session', 'show', 'nonexistent-id-12345'], baseEnv());
    expect(code).not.toBe(0);
  });

  describe('session list flags', () => {
    it('--limit restricts output', async () => {
      const { stdout, code } = await runCliWithEnv(['session', 'list', '--json', '--limit', '1'], baseEnv());
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout) as Array<{ id: string }>;
      expect(parsed.length).toBeLessThanOrEqual(1);
    });

    it('--status filters by status', async () => {
      // The seeded session has no steps, so last_status is null.
      // Filtering by 'complete' should return an empty list.
      const { stdout, code } = await runCliWithEnv(['session', 'list', '--json', '--status', 'complete'], baseEnv());
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout) as Array<{ id: string }>;
      expect(parsed.every((s) => s.id !== fixture.sessionId)).toBe(true);
    });

    it('--all includes all sessions', async () => {
      const { stdout, code } = await runCliWithEnv(['session', 'list', '--json', '--all'], baseEnv());
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout) as Array<{ id: string }>;
      expect(parsed.some((s) => s.id === fixture.sessionId)).toBe(true);
    });

    it('--json + --limit combined', async () => {
      const { stdout, code } = await runCliWithEnv(['session', 'list', '--json', '--limit', '5'], baseEnv());
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout) as Array<{ id: string }>;
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeLessThanOrEqual(5);
    });
  });

  describe('session stats', () => {
    it('prints help with --help', async () => {
      const { stdout, code } = await runCli(['session', 'stats', '--help']);
      expect(code).toBe(0);
      expect(stdout).toContain('stats');
    });

    it('outputs stats', async () => {
      const { stdout, code } = await runCliWithEnv(['session', 'stats'], baseEnv());
      expect(code).toBe(0);
      expect(stdout.length).toBeGreaterThan(0);
    });

    it('--json outputs structured JSON', async () => {
      const { stdout, code } = await runCliWithEnv(['session', 'stats', '--json'], baseEnv());
      expect(code).toBe(0);
      const parsed = JSON.parse(stdout) as { sessions: { total: number }; steps: number };
      expect(typeof parsed.sessions).toBe('object');
      expect(typeof parsed.sessions.total).toBe('number');
      expect(typeof parsed.steps).toBe('number');
    });
  });

  describe('session prune', () => {
    it('prints help with --help', async () => {
      const { stdout, code } = await runCli(['session', 'prune', '--help']);
      expect(code).toBe(0);
      expect(stdout).toContain('--id');
      expect(stdout).toContain('--older-than');
      expect(stdout).toContain('--status');
      expect(stdout).toContain('--yes');
      expect(stdout).toContain('--dry-run');
    });

    it('--dry-run shows what would be deleted', async () => {
      const { stdout, code } = await runCliWithEnv(
        ['session', 'prune', '--id', fixture.sessionId, '--dry-run'],
        baseEnv(),
      );
      expect(code).toBe(0);
      expect(stdout).toContain('Would delete');
      expect(stdout).toContain(fixture.sessionId);
    });

    it('--dry-run + --status combined', async () => {
      // No sessions have status 'complete', so nothing should match
      const { stdout, code } = await runCliWithEnv(
        ['session', 'prune', '--status', 'complete', '--dry-run'],
        baseEnv(),
      );
      expect(code).toBe(0);
      expect(stdout).toContain('No sessions match');
    });

    it('--dry-run + --id targets specific session', async () => {
      const { stdout, code } = await runCliWithEnv(
        ['session', 'prune', '--id', fixture.sessionId, '--dry-run'],
        baseEnv(),
      );
      expect(code).toBe(0);
      expect(stdout).toContain(fixture.sessionId);

      // Session still exists after dry-run
      const { stdout: listOut } = await runCliWithEnv(['session', 'list', '--json'], baseEnv());
      const parsed = JSON.parse(listOut) as Array<{ id: string }>;
      expect(parsed.some((s) => s.id === fixture.sessionId)).toBe(true);
    });

    it('--yes skips confirmation', async () => {
      // Use --older-than 999d so nothing actually matches (safe, no deletion)
      const { stdout, code } = await runCliWithEnv(['session', 'prune', '--older-than', '999d', '--yes'], baseEnv());
      expect(code).toBe(0);
      expect(stdout).toContain('No sessions match');
    });
  });
});
