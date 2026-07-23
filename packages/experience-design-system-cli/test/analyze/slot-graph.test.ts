import { describe, it, expect } from 'vitest';

import { buildComponentGraph, type SlotGraphInput } from '../../src/analyze/slot-graph.js';

type Entry = import('@contentful/experience-design-system-types').CDFComponentEntry;

function entryWithSlots(slots: Record<string, unknown[]>): Entry {
  return {
    $type: 'component',
    $properties: {},
    $slots: Object.fromEntries(
      Object.entries(slots).map(([slotName, allowed]) => [
        slotName,
        { $allowedComponents: allowed },
      ]),
    ),
  } as Entry;
}

function entryNoSlots(): Entry {
  return { $type: 'component', $properties: {} } as Entry;
}

describe('buildComponentGraph — empty input', () => {
  it('returns [] on []', () => {
    expect(buildComponentGraph([])).toEqual([]);
  });

  it('returns [] on [] regardless of options', () => {
    expect(buildComponentGraph([], { stripRejectedEdges: true })).toEqual([]);
    expect(buildComponentGraph([], { stripRejectedEdges: false })).toEqual([]);
  });
});

describe('buildComponentGraph — single-row shapes', () => {
  it('emits an empty slots list when the entry has no $slots', () => {
    const rows: SlotGraphInput[] = [{ key: 'A', entry: entryNoSlots() }];
    expect(buildComponentGraph(rows)).toEqual([{ name: 'A', slots: [] }]);
  });

  it('emits a slot with allowedComponents: [] when $allowedComponents is []', () => {
    const rows: SlotGraphInput[] = [{ key: 'A', entry: entryWithSlots({ s: [] }) }];
    expect(buildComponentGraph(rows)).toEqual([
      { name: 'A', slots: [{ name: 's', allowedComponents: [] }] },
    ]);
  });

  it('emits a slot with a single string allowed target', () => {
    const rows: SlotGraphInput[] = [{ key: 'A', entry: entryWithSlots({ s: ['B'] }) }];
    expect(buildComponentGraph(rows)).toEqual([
      { name: 'A', slots: [{ name: 's', allowedComponents: ['B'] }] },
    ]);
  });
});

describe('buildComponentGraph — multi-row topology', () => {
  it('builds a linear chain A→B→C', () => {
    const rows: SlotGraphInput[] = [
      { key: 'A', entry: entryWithSlots({ s: ['B'] }) },
      { key: 'B', entry: entryWithSlots({ s: ['C'] }) },
      { key: 'C', entry: entryNoSlots() },
    ];
    expect(buildComponentGraph(rows)).toEqual([
      { name: 'A', slots: [{ name: 's', allowedComponents: ['B'] }] },
      { name: 'B', slots: [{ name: 's', allowedComponents: ['C'] }] },
      { name: 'C', slots: [] },
    ]);
  });

  it('does not detect or reject cycles — A↔B just produces both edges', () => {
    const rows: SlotGraphInput[] = [
      { key: 'A', entry: entryWithSlots({ s: ['B'] }) },
      { key: 'B', entry: entryWithSlots({ s: ['A'] }) },
    ];
    expect(buildComponentGraph(rows)).toEqual([
      { name: 'A', slots: [{ name: 's', allowedComponents: ['B'] }] },
      { name: 'B', slots: [{ name: 's', allowedComponents: ['A'] }] },
    ]);
  });
});

describe('buildComponentGraph — $allowedComponents filtering', () => {
  it('filters out non-string members of $allowedComponents', () => {
    const rows: SlotGraphInput[] = [
      {
        key: 'A',
        entry: entryWithSlots({ s: ['B', 42, null, { name: 'nope' }, 'C'] }),
      },
    ];
    expect(buildComponentGraph(rows)).toEqual([
      { name: 'A', slots: [{ name: 's', allowedComponents: ['B', 'C'] }] },
    ]);
  });

  it('coerces a non-array $allowedComponents to an empty list', () => {
    const rows: SlotGraphInput[] = [
      {
        key: 'A',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        entry: { $type: 'component', $properties: {}, $slots: { s: { $allowedComponents: 'nope' } } } as any,
      },
    ];
    expect(buildComponentGraph(rows)).toEqual([
      { name: 'A', slots: [{ name: 's', allowedComponents: [] }] },
    ]);
  });
});

describe('buildComponentGraph — stripRejectedEdges', () => {
  const rowWith = (status: string | undefined): SlotGraphInput => ({
    key: 'A',
    entry: entryWithSlots({ s: ['B'] }),
    status,
  });

  it("emits empty slots when stripRejectedEdges=true and status='error'", () => {
    expect(buildComponentGraph([rowWith('error')], { stripRejectedEdges: true })).toEqual([
      { name: 'A', slots: [] },
    ]);
  });

  it("emits empty slots when stripRejectedEdges=true and status='rejected'", () => {
    expect(buildComponentGraph([rowWith('rejected')], { stripRejectedEdges: true })).toEqual([
      { name: 'A', slots: [] },
    ]);
  });

  it("preserves edges when stripRejectedEdges=true and status='accepted'", () => {
    expect(buildComponentGraph([rowWith('accepted')], { stripRejectedEdges: true })).toEqual([
      { name: 'A', slots: [{ name: 's', allowedComponents: ['B'] }] },
    ]);
  });

  it('preserves edges when stripRejectedEdges=true and status is undefined', () => {
    expect(buildComponentGraph([rowWith(undefined)], { stripRejectedEdges: true })).toEqual([
      { name: 'A', slots: [{ name: 's', allowedComponents: ['B'] }] },
    ]);
  });

  it("preserves edges when stripRejectedEdges=false and status='error'", () => {
    expect(buildComponentGraph([rowWith('error')], { stripRejectedEdges: false })).toEqual([
      { name: 'A', slots: [{ name: 's', allowedComponents: ['B'] }] },
    ]);
  });

  it("preserves edges when opts is omitted and status='error'", () => {
    expect(buildComponentGraph([rowWith('error')])).toEqual([
      { name: 'A', slots: [{ name: 's', allowedComponents: ['B'] }] },
    ]);
  });

  it("preserves edges for statuses that are neither 'error' nor 'rejected'", () => {
    for (const status of ['needs-review', 'undecided', 'warning', 'ok', 'anything']) {
      expect(buildComponentGraph([rowWith(status)], { stripRejectedEdges: true })).toEqual([
        { name: 'A', slots: [{ name: 's', allowedComponents: ['B'] }] },
      ]);
    }
  });
});

describe('buildComponentGraph — shape tolerance and purity', () => {
  it('ignores extra properties on the input row', () => {
    const rows = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { key: 'A', entry: entryWithSlots({ s: ['B'] }), status: 'accepted', foo: 42, bar: 'baz' } as any,
    ];
    expect(buildComponentGraph(rows as SlotGraphInput[])).toEqual([
      { name: 'A', slots: [{ name: 's', allowedComponents: ['B'] }] },
    ]);
  });

  it('is deterministic — same input twice returns structurally equal output', () => {
    const rows: SlotGraphInput[] = [
      { key: 'A', entry: entryWithSlots({ s: ['B'] }) },
      { key: 'B', entry: entryWithSlots({ x: ['C'], y: [] }) },
      { key: 'C', entry: entryNoSlots() },
    ];
    const first = buildComponentGraph(rows);
    const second = buildComponentGraph(rows);
    expect(second).toEqual(first);
  });

  it('does not mutate its input rows', () => {
    const entry = entryWithSlots({ s: ['B'] });
    const snapshot = JSON.stringify(entry);
    const rows: SlotGraphInput[] = [{ key: 'A', entry, status: 'error' }];
    buildComponentGraph(rows, { stripRejectedEdges: true });
    buildComponentGraph(rows, { stripRejectedEdges: false });
    expect(JSON.stringify(entry)).toEqual(snapshot);
  });
});
