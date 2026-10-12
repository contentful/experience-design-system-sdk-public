import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getOrCreateSession,
  openPipelineDb,
  storeRawComponents,
} from '@contentful/experience-design-system-backend-pipeline';
import { loadScopeGate } from '../../../src/tui/import/steps/07-scope-gate/load.js';

const component = (name: string, slots: Array<{ name: string; allowedComponents?: string[] }> = []) => ({
  name,
  source: `src/${name}.tsx`,
  framework: 'react' as const,
  props: [],
  slots: slots.map((s) => ({
    name: s.name,
    isDefault: false,
    ...(s.allowedComponents ? { allowedComponents: s.allowedComponents } : {}),
  })),
});

describe('loadScopeGate', () => {
  let dir: string;
  let previousDbPath: string | undefined;

  const seed = (components: ReturnType<typeof component>[]): string => {
    const db = openPipelineDb();
    try {
      const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
      storeRawComponents(db, sessionId, components);
      return sessionId;
    } finally {
      db.close();
    }
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'scope-gate-load-'));
    previousDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'pipeline.db');
  });

  afterEach(async () => {
    if (previousDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  });

  it('returns the extracted components, sorted by name', () => {
    const sessionId = seed([component('Card'), component('Button')]);
    const result = loadScopeGate(sessionId);
    expect(result.ok && result.components.map((c) => c.name)).toEqual(['Button', 'Card']);
  });

  it('includes what each component allows in its slots', () => {
    const sessionId = seed([
      component('Card', [{ name: 'children', allowedComponents: ['Button'] }]),
      component('Button'),
    ]);
    const result = loadScopeGate(sessionId);
    const card = result.ok ? result.components.find((c) => c.name === 'Card') : undefined;
    expect(card?.slots).toEqual([{ name: 'children', allowedComponents: ['Button'] }]);
  });

  it('says so when the session has no components, instead of an empty gate', () => {
    seed([component('Button')]);
    const result = loadScopeGate('no-such-session');
    expect(result).toEqual({ ok: false, message: expect.stringContaining('No components found') });
  });

  it('returns the failure as a result when the database cannot be read', async () => {
    // a plain file where a directory is needed, so the database can be neither created nor opened
    await writeFile(join(dir, 'not-a-dir'), 'x');
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'not-a-dir', 'pipeline.db');
    const result = loadScopeGate('any-session');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('Could not read the extracted components');
  });

  it('reads the list once: a later change to the database does not reach a list already loaded', () => {
    const sessionId = seed([component('Button')]);
    const first = loadScopeGate(sessionId);
    const db = openPipelineDb();
    db.prepare("UPDATE raw_components SET status = 'generated' WHERE session_id = ?").run(sessionId);
    db.close();
    expect(first.ok && first.components.map((c) => c.name)).toEqual(['Button']);
    expect(loadScopeGate(sessionId).ok).toBe(false);
  });
});
