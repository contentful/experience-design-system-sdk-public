import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyScopeDecisions,
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

  it('saves and reopens legacy unknown provenance for prototype-like component names', () => {
    const sessionId = seed([component('__proto__'), component('constructor')]);
    const db = openPipelineDb();
    try {
      expect(() =>
        applyScopeDecisions(db, sessionId, {
          accepted: ['__proto__', 'constructor'],
          rejected: [],
        }),
      ).not.toThrow();
    } finally {
      db.close();
    }
    const reopened = loadScopeGate(sessionId);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw new Error(reopened.message);
    expect(Object.hasOwn(reopened.savedDecisions?.acceptedProvenance ?? {}, '__proto__')).toBe(true);
    expect(reopened.savedDecisions?.acceptedProvenance?.__proto__).toEqual({ kind: 'unknown', roots: [] });
    expect(reopened.savedDecisions?.acceptedProvenance?.constructor).toEqual({ kind: 'unknown', roots: [] });
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

  it('reopens the complete saved human partition and its direct/closure provenance', () => {
    const sessionId = seed([
      component('Page', [{ name: 'children', allowedComponents: ['Button'] }]),
      component('Button'),
      component('Other'),
    ]);
    const decisions = {
      accepted: ['Page', 'Button'],
      rejected: ['Other'],
      acceptedProvenance: {
        Page: { kind: 'direct' as const, roots: ['Page'] },
        Button: { kind: 'closure' as const, roots: ['Page'] },
      },
    };
    const db = openPipelineDb();
    try {
      applyScopeDecisions(db, sessionId, decisions);
    } finally {
      db.close();
    }

    const reopened = loadScopeGate(sessionId);
    expect(reopened.ok && reopened.components.map((item) => item.name)).toEqual(['Button', 'Other', 'Page']);
    expect(reopened.ok && reopened.savedDecisions).toEqual({
      ...decisions,
      accepted: ['Button', 'Page'],
      rejected: ['Other'],
    });
  });

  it('rejects a non-partition before changing component statuses or saved choices', () => {
    const sessionId = seed([component('Button'), component('Card')]);
    const db = openPipelineDb();
    try {
      const before = db
        .prepare('SELECT name, status FROM raw_components WHERE session_id = ? ORDER BY name')
        .all(sessionId);

      expect(() =>
        applyScopeDecisions(db, sessionId, { accepted: ['Button', 'Missing'], rejected: ['Card'] }),
      ).toThrow();

      expect(
        db.prepare('SELECT name, status FROM raw_components WHERE session_id = ? ORDER BY name').all(sessionId),
      ).toEqual(before);
      expect(db.prepare('SELECT * FROM scope_decisions WHERE session_id = ?').all(sessionId)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('rejects provenance for a rejected choice before writing any part of the partition', () => {
    const sessionId = seed([component('Button'), component('Card')]);
    const db = openPipelineDb();
    try {
      const before = db
        .prepare('SELECT name, status FROM raw_components WHERE session_id = ? ORDER BY name')
        .all(sessionId);

      expect(() =>
        applyScopeDecisions(db, sessionId, {
          accepted: ['Button'],
          rejected: ['Card'],
          acceptedProvenance: { Card: { kind: 'direct', roots: ['Card'] } },
        }),
      ).toThrow();

      expect(
        db.prepare('SELECT name, status FROM raw_components WHERE session_id = ? ORDER BY name').all(sessionId),
      ).toEqual(before);
      expect(db.prepare('SELECT * FROM scope_decisions WHERE session_id = ?').all(sessionId)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('rejects provenance roots outside the accepted set before changing saved choices', () => {
    const sessionId = seed([component('Button'), component('Card')]);
    const db = openPipelineDb();
    try {
      expect(() =>
        applyScopeDecisions(db, sessionId, {
          accepted: ['Button'],
          rejected: ['Card'],
          acceptedProvenance: { Button: { kind: 'direct', roots: ['Button', 'Card'] } },
        }),
      ).toThrow('non-accepted root');
      expect(db.prepare('SELECT * FROM scope_decisions WHERE session_id = ?').all(sessionId)).toEqual([]);
      expect(
        db.prepare('SELECT name, status FROM raw_components WHERE session_id = ? ORDER BY name').all(sessionId),
      ).toEqual([
        { name: 'Button', status: 'extracted' },
        { name: 'Card', status: 'extracted' },
      ]);
    } finally {
      db.close();
    }
  });

  it('replaces one session partition without changing another session with the same component names', () => {
    const first = seed([component('Button'), component('Card')]);
    const second = seed([component('Button'), component('Card')]);
    const db = openPipelineDb();
    try {
      applyScopeDecisions(db, first, {
        accepted: ['Button'],
        rejected: ['Card'],
        acceptedProvenance: { Button: { kind: 'direct', roots: ['Button'] } },
      });
      applyScopeDecisions(db, second, {
        accepted: ['Card'],
        rejected: ['Button'],
        acceptedProvenance: { Card: { kind: 'direct', roots: ['Card'] } },
      });
      applyScopeDecisions(db, first, {
        accepted: ['Card'],
        rejected: ['Button'],
        acceptedProvenance: { Card: { kind: 'direct', roots: ['Card'] } },
      });
    } finally {
      db.close();
    }

    const firstSaved = loadScopeGate(first);
    const secondSaved = loadScopeGate(second);
    expect(firstSaved.ok && firstSaved.savedDecisions).toEqual({
      accepted: ['Card'],
      rejected: ['Button'],
      acceptedProvenance: { Card: { kind: 'direct', roots: ['Card'] } },
    });
    expect(secondSaved.ok && secondSaved.savedDecisions).toEqual({
      accepted: ['Card'],
      rejected: ['Button'],
      acceptedProvenance: { Card: { kind: 'direct', roots: ['Card'] } },
    });
  });

  it('does not treat AI statuses as human choices and keeps missing provenance unknown', () => {
    const sessionId = seed([component('Button'), component('Card')]);
    const db = openPipelineDb();
    try {
      db.prepare("UPDATE raw_components SET status = 'accepted' WHERE session_id = ? AND name = 'Button'").run(
        sessionId,
      );
      db.prepare("UPDATE raw_components SET status = 'rejected' WHERE session_id = ? AND name = 'Card'").run(sessionId);
      const beforeHumanChoice = loadScopeGate(sessionId);
      expect(beforeHumanChoice.ok && beforeHumanChoice.savedDecisions).toBeUndefined();

      applyScopeDecisions(db, sessionId, { accepted: ['Button'], rejected: ['Card'] });
      db.prepare('UPDATE scope_decisions SET provenance_json = NULL WHERE session_id = ? AND component_name = ?').run(
        sessionId,
        'Button',
      );
    } finally {
      db.close();
    }

    const reopened = loadScopeGate(sessionId);
    expect(reopened.ok && reopened.savedDecisions?.acceptedProvenance?.Button).toEqual({ kind: 'unknown', roots: [] });
  });
});
