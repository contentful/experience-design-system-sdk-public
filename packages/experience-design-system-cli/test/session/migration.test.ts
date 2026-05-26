import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { openPipelineDb } from '../../src/session/db.js';
import { runMigrationIfNeeded } from '../../src/session/migration.js';

const tempDirs: string[] = [];
let originalArtifactsDir: string | undefined;

beforeEach(() => {
  originalArtifactsDir = process.env.EDS_REVIEW_ARTIFACTS_DIR;
});

afterEach(async () => {
  if (originalArtifactsDir === undefined) {
    delete process.env.EDS_REVIEW_ARTIFACTS_DIR;
  } else {
    process.env.EDS_REVIEW_ARTIFACTS_DIR = originalArtifactsDir;
  }
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'migration-test-'));
  tempDirs.push(dir);
  await run(dir);
}

describe('runMigrationIfNeeded', () => {
  it('runs without error when reviews dir is empty', async () => {
    await withTempDir(async (dir) => {
      const reviewsDir = join(dir, 'reviews');
      await mkdir(reviewsDir, { recursive: true });
      process.env.EDS_REVIEW_ARTIFACTS_DIR = reviewsDir;

      const dbPath = join(dir, 'pipeline.db');
      const db = openPipelineDb(dbPath);
      runMigrationIfNeeded(db);

      const migRow = db.prepare("SELECT name FROM migrations WHERE name = 'v1_import_and_reviews'").get() as
        | { name: string }
        | undefined;
      expect(migRow?.name).toBe('v1_import_and_reviews');
      db.close();
    });
  });

  it('migrates a valid review session: creates session + step, renames directory', async () => {
    await withTempDir(async (dir) => {
      const reviewsDir = join(dir, 'reviews');
      const sessionDir = join(reviewsDir, 'sample-input-abc123456789');
      await mkdir(sessionDir, { recursive: true });

      const snapshot = {
        inputPath: '/tmp/sample-input.json',
        components: [
          {
            id: 'Accordion-a1b2c3d4e5f6',
            name: 'Accordion',
            status: 'needs-review',
            resolvedSourcePath: '/repo/src/Accordion.tsx',
          },
        ],
      };
      await writeFile(join(sessionDir, 'current-review-state.json'), JSON.stringify(snapshot), 'utf8');

      process.env.EDS_REVIEW_ARTIFACTS_DIR = reviewsDir;
      const dbPath = join(dir, 'pipeline.db');
      const db = openPipelineDb(dbPath);
      runMigrationIfNeeded(db);

      const sessions = db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
      expect(sessions.n).toBe(1);

      const steps = db.prepare('SELECT COUNT(*) AS n FROM steps').get() as { n: number };
      expect(steps.n).toBe(1);

      // Session directory renamed to .migrated
      expect(existsSync(`${sessionDir}.migrated`)).toBe(true);
      expect(existsSync(sessionDir)).toBe(false);

      db.close();
    });
  });

  it('skips a session with a malformed state file and continues', async () => {
    await withTempDir(async (dir) => {
      const reviewsDir = join(dir, 'reviews');
      const badDir = join(reviewsDir, 'bad-session-123456789abc');
      const goodDir = join(reviewsDir, 'good-session-abc123456789');
      await mkdir(badDir, { recursive: true });
      await mkdir(goodDir, { recursive: true });

      await writeFile(join(badDir, 'current-review-state.json'), '{bad json', 'utf8');
      await writeFile(
        join(goodDir, 'current-review-state.json'),
        JSON.stringify({ inputPath: '/tmp/good.json', components: [] }),
        'utf8',
      );

      process.env.EDS_REVIEW_ARTIFACTS_DIR = reviewsDir;
      const dbPath = join(dir, 'pipeline.db');
      const db = openPipelineDb(dbPath);
      runMigrationIfNeeded(db);

      const sessions = db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
      expect(sessions.n).toBe(1); // only the good one
      db.close();
    });
  });

  it('is idempotent: second run skips migration', async () => {
    await withTempDir(async (dir) => {
      const reviewsDir = join(dir, 'reviews');
      await mkdir(reviewsDir, { recursive: true });
      process.env.EDS_REVIEW_ARTIFACTS_DIR = reviewsDir;

      const dbPath = join(dir, 'pipeline.db');
      const db = openPipelineDb(dbPath);
      runMigrationIfNeeded(db);
      runMigrationIfNeeded(db); // second call — should be a no-op

      const migRows = db.prepare('SELECT COUNT(*) AS n FROM migrations').get() as { n: number };
      expect(migRows.n).toBe(1); // only one migration row inserted
      db.close();
    });
  });

  it('skips import.db migration when import.db does not exist', async () => {
    await withTempDir(async (dir) => {
      const reviewsDir = join(dir, 'reviews');
      await mkdir(reviewsDir, { recursive: true });
      process.env.EDS_REVIEW_ARTIFACTS_DIR = reviewsDir;

      const dbPath = join(dir, 'pipeline.db');
      const db = openPipelineDb(dbPath);
      runMigrationIfNeeded(db); // should not throw

      const migRow = db.prepare("SELECT name FROM migrations WHERE name = 'v1_import_and_reviews'").get() as
        | { name: string }
        | undefined;
      expect(migRow?.name).toBe('v1_import_and_reviews');
      db.close();
    });
  });
});
