import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
  backfillUnclassifiedProps,
} from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'backfill-preclassify-test-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'pipeline.db');
  await run(dbPath);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('backfillUnclassifiedProps with pre-classification', () => {
  it('uses category from pre-classification when available', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });

      const raw: RawComponentDefinition[] = [
        {
          name: 'Logo',
          source: 'src/Logo.tsx',
          framework: 'react',
          props: [
            { name: 'labelText', type: 'string', required: false, category: 'content' },
            { name: 'bgColor', type: 'string', required: false, category: 'design' },
            { name: 'disabled', type: 'boolean', required: false, category: 'state' },
          ],
          slots: [],
        },
      ];
      storeRawComponents(db, sessionId, raw);

      // Mark component as generated
      db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ?`).run(sessionId);

      const count = backfillUnclassifiedProps(db, sessionId);
      expect(count).toBe(3);

      const comp = db.prepare(`SELECT component_id FROM raw_components WHERE session_id = ?`).get(sessionId) as {
        component_id: string;
      };

      const rows = db
        .prepare(
          `SELECT name, cdf_type, cdf_category FROM raw_props WHERE session_id = ? AND component_id = ? ORDER BY position`,
        )
        .all(sessionId, comp.component_id) as Array<{ name: string; cdf_type: string; cdf_category: string }>;

      expect(rows[0]).toEqual({ name: 'labelText', cdf_type: 'string', cdf_category: 'content' });
      expect(rows[1]).toEqual({ name: 'bgColor', cdf_type: 'string', cdf_category: 'design' });
      expect(rows[2]).toEqual({ name: 'disabled', cdf_type: 'string', cdf_category: 'state' });
      db.close();
    });
  });

  it('falls back to content when no category is available', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });

      const raw: RawComponentDefinition[] = [
        {
          name: 'Card',
          source: 'src/Card.tsx',
          framework: 'react',
          props: [{ name: 'item', type: '{ url: string }', required: false }],
          slots: [],
        },
      ];
      storeRawComponents(db, sessionId, raw);

      // Mark component as generated
      db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ?`).run(sessionId);

      const count = backfillUnclassifiedProps(db, sessionId);
      expect(count).toBe(1);

      const comp = db.prepare(`SELECT component_id FROM raw_components WHERE session_id = ?`).get(sessionId) as {
        component_id: string;
      };

      const rows = db
        .prepare(`SELECT name, cdf_type, cdf_category FROM raw_props WHERE session_id = ? AND component_id = ?`)
        .all(sessionId, comp.component_id) as Array<{ name: string; cdf_type: string; cdf_category: string }>;

      expect(rows[0]).toEqual({ name: 'item', cdf_type: 'string', cdf_category: 'content' });
      db.close();
    });
  });

  it('does not overwrite existing cdf_type', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });

      const raw: RawComponentDefinition[] = [
        {
          name: 'Toggle',
          source: 'src/Toggle.tsx',
          framework: 'react',
          props: [{ name: 'variant', type: 'string', required: false, category: 'design' }],
          slots: [],
        },
      ];
      storeRawComponents(db, sessionId, raw);

      // Mark component as generated
      db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ?`).run(sessionId);

      // Simulate AI already classifying this prop
      const comp = db.prepare(`SELECT component_id FROM raw_components WHERE session_id = ?`).get(sessionId) as {
        component_id: string;
      };
      db.prepare(
        `UPDATE raw_props SET cdf_type = 'enum', cdf_category = 'design' WHERE session_id = ? AND component_id = ? AND name = 'variant'`,
      ).run(sessionId, comp.component_id);

      const count = backfillUnclassifiedProps(db, sessionId);
      expect(count).toBe(0);

      const rows = db
        .prepare(`SELECT name, cdf_type, cdf_category FROM raw_props WHERE session_id = ? AND component_id = ?`)
        .all(sessionId, comp.component_id) as Array<{ name: string; cdf_type: string; cdf_category: string }>;

      expect(rows[0]).toEqual({ name: 'variant', cdf_type: 'enum', cdf_category: 'design' });
      db.close();
    });
  });

  it('only backfills props on generated components', async () => {
    await withTempDb((dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });

      const raw: RawComponentDefinition[] = [
        {
          name: 'Draft',
          source: 'src/Draft.tsx',
          framework: 'react',
          props: [{ name: 'title', type: 'string', required: false, category: 'content' }],
          slots: [],
        },
      ];
      storeRawComponents(db, sessionId, raw);

      // Leave component in default status (NOT 'generated')
      // storeRawComponents sets status to 'pending' by default

      const count = backfillUnclassifiedProps(db, sessionId);
      expect(count).toBe(0);

      const comp = db.prepare(`SELECT component_id FROM raw_components WHERE session_id = ?`).get(sessionId) as {
        component_id: string;
      };

      const rows = db
        .prepare(`SELECT name, cdf_type FROM raw_props WHERE session_id = ? AND component_id = ?`)
        .all(sessionId, comp.component_id) as Array<{ name: string; cdf_type: string | null }>;

      expect(rows[0]!.cdf_type).toBeNull();
      db.close();
    });
  });
});
