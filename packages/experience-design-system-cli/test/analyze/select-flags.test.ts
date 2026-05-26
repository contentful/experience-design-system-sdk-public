import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli, runCliWithEnv } from '../helpers/cli-runner.js';
import { createTestFixture, type TestFixture } from '../helpers/fixtures.js';
import { openPipelineDb, createStep, updateStep } from '../../src/session/db.js';

/**
 * Creates a test fixture whose session has a *completed* `analyze extract`
 * step so that `resolveSessionId()` can find it when `--session` is omitted.
 * A fresh artifactsDir is created to isolate state-file writes per test.
 */
type FullFixture = TestFixture & { artifactsDir: string };

async function createFullFixture(): Promise<FullFixture> {
  const fixture = await createTestFixture();
  const artifactsDir = await mkdtemp(join(tmpdir(), 'exo-e2e-artifacts-'));

  const db = openPipelineDb(fixture.dbPath);
  const stepId = createStep(db, fixture.sessionId, 'analyze extract', { project: fixture.projectDir });
  updateStep(db, stepId, 'complete', { sessionId: fixture.sessionId });
  db.close();

  return {
    ...fixture,
    artifactsDir,
    cleanup: async () => {
      await fixture.cleanup();
      await rm(artifactsDir, { recursive: true, force: true });
    },
  };
}

// ── 1. --help (no fixture needed) ─────────────────────────────────────────────

describe('analyze select — --help', () => {
  it('shows all flags', async () => {
    const { stdout, code } = await runCli(['analyze', 'select', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--session');
    expect(stdout).toContain('--project-root');
    expect(stdout).toContain('--select-all');
    expect(stdout).toContain('--select');
    expect(stdout).toContain('--deselect');
    expect(stdout).toContain('--accept-all');
    expect(stdout).toContain('--reject');
    expect(stdout).toContain('--patch');
  });
});

// ── Stateful tests — each gets its own isolated fixture ───────────────────────

describe('analyze select — flag combinations (E2E)', () => {
  // ── 2. --select-all ──────────────────────────────────────────────────────────

  describe('--select-all', () => {
    let fixture: FullFixture;
    beforeAll(async () => {
      fixture = await createFullFixture();
    });
    afterAll(async () => {
      await fixture.cleanup();
    });

    it('selects all components and exits 0', async () => {
      const { stderr, code } = await runCliWithEnv(
        ['analyze', 'select', '--session', fixture.sessionId, '--project-root', fixture.projectDir, '--select-all'],
        { EDS_PIPELINE_DB_PATH: fixture.dbPath, EDS_REVIEW_ARTIFACTS_DIR: fixture.artifactsDir, NODE_NO_WARNINGS: '1' },
      );
      expect(code).toBe(0);
      expect(stderr).toContain('Accepted: 2');
      expect(stderr).toContain('Rejected: 0');
    });
  });

  // ── 3. --accept-all alias ────────────────────────────────────────────────────

  describe('--accept-all', () => {
    let fixture: FullFixture;
    beforeAll(async () => {
      fixture = await createFullFixture();
    });
    afterAll(async () => {
      await fixture.cleanup();
    });

    it('is an alias for --select-all', async () => {
      const { stderr, code } = await runCliWithEnv(
        ['analyze', 'select', '--session', fixture.sessionId, '--project-root', fixture.projectDir, '--accept-all'],
        { EDS_PIPELINE_DB_PATH: fixture.dbPath, EDS_REVIEW_ARTIFACTS_DIR: fixture.artifactsDir, NODE_NO_WARNINGS: '1' },
      );
      expect(code).toBe(0);
      expect(stderr).toContain('Accepted: 2');
      expect(stderr).toContain('Rejected: 0');
    });
  });

  // ── 4. --select <pattern> ─────────────────────────────────────────────────────

  describe('--select', () => {
    let fixture: FullFixture;
    beforeAll(async () => {
      fixture = await createFullFixture();
    });
    afterAll(async () => {
      await fixture.cleanup();
    });

    it('selects only matching components', async () => {
      const { stderr, code } = await runCliWithEnv(
        [
          'analyze',
          'select',
          '--session',
          fixture.sessionId,
          '--project-root',
          fixture.projectDir,
          '--select',
          'button',
        ],
        { EDS_PIPELINE_DB_PATH: fixture.dbPath, EDS_REVIEW_ARTIFACTS_DIR: fixture.artifactsDir, NODE_NO_WARNINGS: '1' },
      );
      expect(code).toBe(0);
      // Button matches, Card does not — Card stays needs-review (neither accepted nor rejected)
      expect(stderr).toContain('Accepted: 1');
      expect(stderr).toContain('Rejected: 0');
    });
  });

  // ── 5. --deselect <pattern> ────────────────────────────────────────────────────

  describe('--deselect', () => {
    let fixture: FullFixture;
    beforeAll(async () => {
      fixture = await createFullFixture();
    });
    afterAll(async () => {
      await fixture.cleanup();
    });

    it('deselects matching components', async () => {
      const { stderr, code } = await runCliWithEnv(
        [
          'analyze',
          'select',
          '--session',
          fixture.sessionId,
          '--project-root',
          fixture.projectDir,
          '--deselect',
          'card',
        ],
        { EDS_PIPELINE_DB_PATH: fixture.dbPath, EDS_REVIEW_ARTIFACTS_DIR: fixture.artifactsDir, NODE_NO_WARNINGS: '1' },
      );
      expect(code).toBe(0);
      expect(stderr).toContain('Rejected: 1');
    });
  });

  // ── 6. --reject alias ─────────────────────────────────────────────────────────

  describe('--reject', () => {
    let fixture: FullFixture;
    beforeAll(async () => {
      fixture = await createFullFixture();
    });
    afterAll(async () => {
      await fixture.cleanup();
    });

    it('is an alias for --deselect', async () => {
      const { stderr, code } = await runCliWithEnv(
        ['analyze', 'select', '--session', fixture.sessionId, '--project-root', fixture.projectDir, '--reject', 'card'],
        { EDS_PIPELINE_DB_PATH: fixture.dbPath, EDS_REVIEW_ARTIFACTS_DIR: fixture.artifactsDir, NODE_NO_WARNINGS: '1' },
      );
      expect(code).toBe(0);
      expect(stderr).toContain('Rejected: 1');
    });
  });

  // ── 7. --select + --deselect combined ─────────────────────────────────────────

  describe('--select + --deselect combined', () => {
    let fixture: FullFixture;
    beforeAll(async () => {
      fixture = await createFullFixture();
    });
    afterAll(async () => {
      await fixture.cleanup();
    });

    it('applies both patterns: deselect takes precedence over select for same component', async () => {
      const { stderr, code } = await runCliWithEnv(
        [
          'analyze',
          'select',
          '--session',
          fixture.sessionId,
          '--project-root',
          fixture.projectDir,
          '--select',
          'button',
          '--deselect',
          'card',
        ],
        { EDS_PIPELINE_DB_PATH: fixture.dbPath, EDS_REVIEW_ARTIFACTS_DIR: fixture.artifactsDir, NODE_NO_WARNINGS: '1' },
      );
      expect(code).toBe(0);
      // --deselect takes precedence for Card; Button is accepted
      expect(stderr).toContain('Accepted: 1');
      expect(stderr).toContain('Rejected: 1');
    });
  });

  // ── 8. Invalid --session fails ────────────────────────────────────────────────

  describe('invalid --session', () => {
    let fixture: FullFixture;
    beforeAll(async () => {
      fixture = await createFullFixture();
    });
    afterAll(async () => {
      await fixture.cleanup();
    });

    it('fails with a non-existent session id', async () => {
      const { code } = await runCliWithEnv(
        ['analyze', 'select', '--session', 'nonexistent-session-id-xyz', '--select-all'],
        { EDS_PIPELINE_DB_PATH: fixture.dbPath, EDS_REVIEW_ARTIFACTS_DIR: fixture.artifactsDir, NODE_NO_WARNINGS: '1' },
      );
      expect(code).not.toBe(0);
    });
  });

  // ── 9. Default to most recent session ──────────────────────────────────────────

  describe('--session omitted', () => {
    let fixture: FullFixture;
    beforeAll(async () => {
      fixture = await createFullFixture();
    });
    afterAll(async () => {
      await fixture.cleanup();
    });

    it('defaults to the most recent completed session', async () => {
      const { stderr, code } = await runCliWithEnv(
        ['analyze', 'select', '--project-root', fixture.projectDir, '--select-all'],
        { EDS_PIPELINE_DB_PATH: fixture.dbPath, EDS_REVIEW_ARTIFACTS_DIR: fixture.artifactsDir, NODE_NO_WARNINGS: '1' },
      );
      expect(code).toBe(0);
      expect(stderr).toContain('Accepted:');
    });
  });
});
