import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPipelineDb, getOrCreateSession } from '../src/session/repositories/db.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function databasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'source-schema-'));
  directories.push(directory);
  return join(directory, 'pipeline.db');
}
it('installs compact captured-source authority and its currentness fences through normal database opening', () => {
  const db = openPipelineDb(databasePath());
  try {
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_captured_source_roots'").get(),
    ).toBeDefined();
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND name='session_captured_source_roots_immutable'",
        )
        .get(),
    ).toBeDefined();
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='session_captured_source_step_current'")
        .get(),
    ).toBeDefined();
  } finally {
    db.close();
  }
});
it('upgrades an existing database without removing its session and remains idempotent on reopening', () => {
  const path = databasePath();
  const original = openPipelineDb(path);
  const { sessionId } = getOrCreateSession(original, 'new', undefined, { command: 'analyze extract' });
  original.exec(
    'DROP TABLE IF EXISTS session_captured_source_roots; DROP TRIGGER IF EXISTS session_captured_source_step_current;',
  );
  original.close();
  for (let iteration = 0; iteration < 2; iteration++) {
    const db = openPipelineDb(path);
    try {
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_captured_source_roots'").get(),
      ).toBeDefined();
      expect(db.prepare('SELECT id FROM sessions WHERE id=?').get(sessionId)).toEqual({ id: sessionId });
    } finally {
      db.close();
    }
  }
});

interface CapturedSourceFixture {
  db: ReturnType<typeof openPipelineDb>;
  stepId: number;
  close(): void;
}
function capturedSourceFixture(): CapturedSourceFixture {
  const db = openPipelineDb(databasePath());
  const now = new Date(0).toISOString();
  db.prepare('INSERT INTO sessions (id, created_at, updated_at) VALUES (?,?,?)').run('session-a', now, now);
  const stepId = Number(
    db
      .prepare(
        "INSERT INTO steps (session_id, command, status, started_at, updated_at, outputs) VALUES ('session-a','analyze extract','complete',?,?,?)",
      )
      .run(
        now,
        now,
        JSON.stringify({
          sourceEnvelopeId: 'envelope-a',
          sourceEnvelopeDigest: 'digest-a',
          sourceExtractionStepId: '1',
        }),
      ).lastInsertRowid,
  );
  db.prepare("INSERT INTO session_source_envelopes VALUES ('envelope-a','session-a',?,'digest-a','{}',?)").run(
    stepId,
    now,
  );
  db.prepare(
    "INSERT INTO session_captured_source_roots (envelope_id, descriptor_json) VALUES ('envelope-a','{}')",
  ).run();
  db.prepare(
    "INSERT INTO session_source_validation_receipts VALUES ('store-a',1,'session-a',?,'{}','physical','catalog')",
  ).run(stepId);
  return { db, stepId, close: () => db.close() };
}
function rootCurrent(db: CapturedSourceFixture['db']): unknown {
  return db.prepare("SELECT current FROM session_captured_source_roots WHERE envelope_id='envelope-a'").get()?.current;
}
function updateStep(fixture: CapturedSourceFixture, assignments: string, ...values: Array<string | number>): void {
  fixture.db.prepare(`UPDATE steps SET ${assignments} WHERE id=?`).run(...values, fixture.stepId);
}

it('rejects every update to source envelopes and validation receipts', () => {
  const fixture = capturedSourceFixture();
  try {
    expect(() => fixture.db.exec("UPDATE session_source_envelopes SET digest='digest-b'")).toThrow(
      'source envelopes are immutable',
    );
    expect(() => fixture.db.exec("UPDATE session_source_validation_receipts SET catalog_identity='other'")).toThrow(
      'source validation receipts are immutable',
    );
    expect(fixture.db.prepare('SELECT digest FROM session_source_envelopes').get()).toEqual({ digest: 'digest-a' });
  } finally {
    fixture.close();
  }
});

it('rejects captured-source root rewrites and revival while allowing retirement', () => {
  const fixture = capturedSourceFixture();
  try {
    expect(() => fixture.db.exec('UPDATE session_captured_source_roots SET descriptor_json=\'{"a":1}\'')).toThrow(
      'captured source roots are immutable',
    );
    fixture.db.exec('UPDATE session_captured_source_roots SET current=0');
    expect(rootCurrent(fixture.db)).toBe(0);
    expect(() => fixture.db.exec('UPDATE session_captured_source_roots SET current=1')).toThrow(
      'captured source roots are immutable',
    );
    expect(rootCurrent(fixture.db)).toBe(0);
  } finally {
    fixture.close();
  }
});

it('removes captured-source rows with their session instead of blocking deletion', () => {
  const fixture = capturedSourceFixture();
  try {
    fixture.db.exec("DELETE FROM sessions WHERE id='session-a'");
    for (const table of [
      'session_source_envelopes',
      'session_captured_source_roots',
      'session_source_validation_receipts',
    ])
      expect(fixture.db.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
  } finally {
    fixture.close();
  }
});

it('keeps a captured-source root current while its extraction step still publishes that envelope', () => {
  const fixture = capturedSourceFixture();
  try {
    updateStep(
      fixture,
      'outputs=?',
      JSON.stringify({
        sourceEnvelopeId: 'envelope-a',
        sourceEnvelopeDigest: 'digest-a',
        sourceExtractionStepId: String(fixture.stepId),
        extra: true,
      }),
    );
    expect(rootCurrent(fixture.db)).toBe(1);
  } finally {
    fixture.close();
  }
});

it.each([
  ['the step leaves completion', "status='failed'", []],
  ['the step command changes', "command='analyze select'", []],
  ['the outputs name another envelope', 'outputs=?', [JSON.stringify({ sourceEnvelopeId: 'envelope-b' })]],
  [
    'the outputs carry another digest',
    'outputs=?',
    [JSON.stringify({ sourceEnvelopeId: 'envelope-a', sourceEnvelopeDigest: 'digest-b', sourceExtractionStepId: '1' })],
  ],
  ['the outputs are not valid JSON', "outputs='not json'", []],
] as Array<[string, string, string[]]>)(
  'retires the captured-source root when %s',
  (_scenario, assignments, values) => {
    const fixture = capturedSourceFixture();
    try {
      expect(rootCurrent(fixture.db)).toBe(1);
      updateStep(fixture, assignments, ...values);
      expect(rootCurrent(fixture.db)).toBe(0);
    } finally {
      fixture.close();
    }
  },
);
