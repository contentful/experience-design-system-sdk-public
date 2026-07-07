import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openPipelineDb,
  getOrCreateSession,
  storeRawComponents,
  storeSlotCycles,
  loadSlotCycles,
} from '../../src/session/db.js';
import { findSlotCycles, suggestCycleBreakEdge } from '../../src/analyze/cycle-detection.js';
import type { RawComponentDefinition } from '../../src/types.js';

const tempDirs: string[] = [];

async function withTempDb(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'cycle-integ-test-'));
  tempDirs.push(dir);
  const dbPath = join(dir, 'pipeline.db');
  await run(dbPath);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function raw(name: string, slots: Array<[string, string[]]>): RawComponentDefinition {
  return {
    name,
    source: `/virtual/${name}.tsx`,
    framework: 'react',
    props: [],
    slots: slots.map(([slotName, allowed]) => ({
      name: slotName,
      isDefault: false,
      allowedComponents: allowed,
    })),
  };
}

describe('extract-time cycle detection integration', () => {
  it('records a 2-cycle when A.slot allows B and B.slot allows A', async () => {
    await withTempDb(async (dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', 'test', { command: 'analyze extract' });

      const components: RawComponentDefinition[] = [
        raw('CycleA', [['inner', ['CycleB']]]),
        raw('CycleB', [['inner', ['CycleA']]]),
      ];
      storeRawComponents(db, sessionId, components);

      const cycleInput = components.map((c) => ({
        name: c.name,
        slots: c.slots.map((s) => ({ name: s.name, allowedComponents: s.allowedComponents })),
      }));
      const cycles = findSlotCycles(cycleInput);
      const withBreaks = cycles.map((cycle) => ({
        ...cycle,
        suggestedBreak: suggestCycleBreakEdge(cycle, cycles),
      }));
      storeSlotCycles(db, sessionId, withBreaks);

      const loaded = loadSlotCycles(db, sessionId);
      expect(loaded).toHaveLength(1);
      const participants = new Set(loaded[0].path);
      expect(participants).toEqual(new Set(['CycleA', 'CycleB']));
      expect(loaded[0].suggestedBreak).not.toBeNull();
      db.close();
    });
  });

  it('records nothing when the slot graph has no cycle', async () => {
    await withTempDb(async (dbPath) => {
      const db = openPipelineDb(dbPath);
      const { sessionId } = getOrCreateSession(db, 'new', 'test', { command: 'analyze extract' });
      const components: RawComponentDefinition[] = [
        raw('Card', [['header', ['Heading']]]),
        raw('Heading', []),
      ];
      const cycleInput = components.map((c) => ({
        name: c.name,
        slots: c.slots.map((s) => ({ name: s.name, allowedComponents: s.allowedComponents })),
      }));
      const cycles = findSlotCycles(cycleInput);
      storeSlotCycles(db, sessionId, cycles);
      expect(loadSlotCycles(db, sessionId)).toHaveLength(0);
      db.close();
    });
  });
});
