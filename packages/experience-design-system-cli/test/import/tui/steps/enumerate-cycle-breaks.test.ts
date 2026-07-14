import { describe, it, expect } from 'vitest';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  enumerateCycleBreaks,
  shouldBreakOverlayGoFullScreen,
} from '../../../../src/import/tui/steps/enumerate-cycle-breaks.js';

const comp = (slots: Record<string, string[]>): CDFComponentEntry =>
  ({
    $type: 'component',
    $properties: {},
    $slots: Object.fromEntries(
      Object.entries(slots).map(([name, allowed]) => [name, { $allowedComponents: allowed }]),
    ),
  }) as unknown as CDFComponentEntry;

describe('enumerateCycleBreaks', () => {
  it('returns one break edge per cycle-path edge for a 2-node cycle', () => {
    const components = [
      { key: 'CycleA', entry: comp({ header: ['CycleB'] }) },
      { key: 'CycleB', entry: comp({ footer: ['CycleA'] }) },
    ];
    const cycle = {
      edges: [
        { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
        { fromComponent: 'CycleB', slotName: 'footer', toComponent: 'CycleA' },
      ],
    };
    const breaks = enumerateCycleBreaks(cycle, components);
    expect(breaks).toEqual([
      { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
      { fromComponent: 'CycleB', slotName: 'footer', toComponent: 'CycleA' },
    ]);
  });

  it('returns three break edges for a 3-node cycle', () => {
    const components = [
      { key: 'A', entry: comp({ s1: ['B'] }) },
      { key: 'B', entry: comp({ s2: ['C'] }) },
      { key: 'C', entry: comp({ s3: ['A'] }) },
    ];
    const cycle = {
      edges: [
        { fromComponent: 'A', slotName: 's1', toComponent: 'B' },
        { fromComponent: 'B', slotName: 's2', toComponent: 'C' },
        { fromComponent: 'C', slotName: 's3', toComponent: 'A' },
      ],
    };
    expect(enumerateCycleBreaks(cycle, components)).toHaveLength(3);
  });

  it('excludes an edge whose $allowedComponents no longer contains the target (stale cycle)', () => {
    const components = [
      { key: 'CycleA', entry: comp({ header: [] }) },
      { key: 'CycleB', entry: comp({ footer: ['CycleA'] }) },
    ];
    const cycle = {
      edges: [
        { fromComponent: 'CycleA', slotName: 'header', toComponent: 'CycleB' },
        { fromComponent: 'CycleB', slotName: 'footer', toComponent: 'CycleA' },
      ],
    };
    expect(enumerateCycleBreaks(cycle, components)).toEqual([
      { fromComponent: 'CycleB', slotName: 'footer', toComponent: 'CycleA' },
    ]);
  });

  it('dedupes identical (from, slot, to) triples', () => {
    const components = [{ key: 'A', entry: comp({ s: ['A'] }) }];
    const cycle = {
      edges: [
        { fromComponent: 'A', slotName: 's', toComponent: 'A' },
        { fromComponent: 'A', slotName: 's', toComponent: 'A' },
      ],
    };
    expect(enumerateCycleBreaks(cycle, components)).toEqual([
      { fromComponent: 'A', slotName: 's', toComponent: 'A' },
    ]);
  });
});

describe('shouldBreakOverlayGoFullScreen', () => {
  it('fits in the right panel on a tall terminal', () => {
    expect(shouldBreakOverlayGoFullScreen({ rows: 40, edgeCount: 2 })).toBe(false);
  });

  it('goes full-screen when the terminal is short', () => {
    expect(shouldBreakOverlayGoFullScreen({ rows: 14, edgeCount: 2 })).toBe(true);
  });

  it('goes full-screen when the edge list is long relative to available rows', () => {
    expect(shouldBreakOverlayGoFullScreen({ rows: 24, edgeCount: 20 })).toBe(true);
  });
});
