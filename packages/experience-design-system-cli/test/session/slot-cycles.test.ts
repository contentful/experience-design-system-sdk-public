import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openPipelineDb,
  getOrCreateSession,
  storeSlotCycles,
  loadSlotCycles,
  clearSlotCycles,
} from '../../src/session/db.js';
import type { SlotCycle, SlotEdge } from '../../src/analyze/cycle-detection.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'slot-cycles-test-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'pipeline.db');
  await run(dbPath);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const cycleA: SlotCycle = {
  path: ['CardA', 'CardB', 'CardA'],
  edges: [
    { fromComponent: 'CardA', slotName: 'header', toComponent: 'CardB' },
    { fromComponent: 'CardB', slotName: 'footer', toComponent: 'CardA' },
  ],
};

const suggestedBreakA: SlotEdge = { fromComponent: 'CardA', slotName: 'header', toComponent: 'CardB' };

describe('slot_cycles persistence', () => {
  it('stores and loads cycles round-trip', async () => {
    await withTempDb(async (dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', 'test', { command: 'analyze extract' });
      storeSlotCycles(db, sessionId, [{ ...cycleA, suggestedBreak: suggestedBreakA }]);

      const loaded = loadSlotCycles(db, sessionId);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].path).toEqual(cycleA.path);
      expect(loaded[0].edges).toEqual(cycleA.edges);
      expect(loaded[0].suggestedBreak).toEqual(suggestedBreakA);
      db.close();
    });
  });

  it('handles null suggestedBreak', async () => {
    await withTempDb(async (dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', 'test', { command: 'analyze extract' });
      storeSlotCycles(db, sessionId, [cycleA]);
      const loaded = loadSlotCycles(db, sessionId);
      expect(loaded[0].suggestedBreak).toBeNull();
      db.close();
    });
  });

  it('overwrites prior cycles on repeat store', async () => {
    await withTempDb(async (dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', 'test', { command: 'analyze extract' });
      storeSlotCycles(db, sessionId, [cycleA, cycleA]);
      expect(loadSlotCycles(db, sessionId)).toHaveLength(2);
      storeSlotCycles(db, sessionId, []);
      expect(loadSlotCycles(db, sessionId)).toHaveLength(0);
      db.close();
    });
  });

  it('clearSlotCycles removes all rows for a session', async () => {
    await withTempDb(async (dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', 'test', { command: 'analyze extract' });
      storeSlotCycles(db, sessionId, [cycleA]);
      clearSlotCycles(db, sessionId);
      expect(loadSlotCycles(db, sessionId)).toHaveLength(0);
      db.close();
    });
  });
});
