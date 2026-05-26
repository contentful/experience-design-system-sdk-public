import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCli, runCliWithEnv } from '../helpers/cli-runner.js';
import { createTestFixture, type TestFixture } from '../helpers/fixtures.js';
import { join } from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

describe('print commands — flag variations', () => {
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

  describe('print components', () => {
    it('prints help with --help', async () => {
      const { stdout, code } = await runCli(['print', 'components', '--help']);
      expect(code).toBe(0);
      expect(stdout).toContain('--session');
      expect(stdout).toContain('--out');
    });

    it('writes components JSON to file with --out', async () => {
      // The fixture seeds RAW components only; print components needs CDF-generated components.
      // A session without CDF data exits 1. We verify the flag is accepted and the error is clean.
      const outDir = await mkdtemp(join(tmpdir(), 'exo-print-'));
      const outPath = join(outDir, 'components.json');
      const { stderr, code } = await runCliWithEnv(
        ['print', 'components', '--session', fixture.sessionId, '--out', outPath],
        baseEnv(),
      );
      // The fixture session has no generated (CDF) components, so the CLI exits 1 with a clear message.
      expect(code).toBe(1);
      expect(stderr).toContain('no generated components');
    });

    it('--out flag is accepted and not treated as unknown', async () => {
      // Ensure --out does not cause a "unknown option" error regardless of session state.
      const outDir = await mkdtemp(join(tmpdir(), 'exo-print-flag-'));
      const outPath = join(outDir, 'components.json');
      const { stderr } = await runCliWithEnv(
        ['print', 'components', '--session', fixture.sessionId, '--out', outPath],
        baseEnv(),
      );
      expect(stderr).not.toContain('unknown option');
    });

    it('outputs components JSON to file when CDF data is present', async () => {
      // Seed a session with actual CDF components via a separate DB setup.
      const { openPipelineDb, getOrCreateSession, storeCDFComponents } = await import('../../src/session/db.js');
      const { mkdtemp: mkd, rm } = await import('node:fs/promises');
      const cdfDir = await mkd(join(tmpdir(), 'exo-cdf-'));
      const cdfDbPath = join(cdfDir, 'pipeline.db');

      const db = openPipelineDb(cdfDbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, {
        command: 'generate components',
      });
      storeCDFComponents(db, sessionId, [
        {
          key: 'Button',
          entry: {
            $type: 'component',
            $description: 'A button',
            $properties: {
              label: { $type: 'string', $category: 'content', $required: true },
            },
          },
        },
      ]);
      db.close();

      const outDir = await mkd(join(tmpdir(), 'exo-cdf-out-'));
      const outPath = join(outDir, 'components.json');

      const { code } = await runCliWithEnv(['print', 'components', '--session', sessionId, '--out', outPath], {
        EDS_PIPELINE_DB_PATH: cdfDbPath,
        NODE_NO_WARNINGS: '1',
      });
      expect(code).toBe(0);

      const written = JSON.parse(await readFile(outPath, 'utf8')) as Record<string, unknown>;
      expect(written['Button']).toBeDefined();

      await rm(cdfDir, { recursive: true, force: true });
      await rm(outDir, { recursive: true, force: true });
    });
  });

  describe('print tokens', () => {
    it('prints help with --help', async () => {
      const { stdout, code } = await runCli(['print', 'tokens', '--help']);
      expect(code).toBe(0);
      expect(stdout).toContain('--session');
      expect(stdout).toContain('--out');
    });

    it('--session flag is accepted for print tokens', async () => {
      // A session without generated tokens exits 1 cleanly — not an unknown-flag error.
      const outDir = await mkdtemp(join(tmpdir(), 'exo-tok-flag-'));
      const outPath = join(outDir, 'tokens.json');
      const { stderr, code } = await runCliWithEnv(
        ['print', 'tokens', '--session', fixture.sessionId, '--out', outPath],
        baseEnv(),
      );
      expect(code).toBe(1);
      expect(stderr).not.toContain('unknown option');
      expect(stderr).toContain('no generated tokens');
    });
  });
});
