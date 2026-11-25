import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countPreparation,
  preparationOperation,
  preparationOwnerRead,
  withPreparationCounters,
} from '../../src/profiling/preparation-counters.js';

let directory: string;
const reports = () =>
  readdirSync(directory)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => ({
      file,
      events: readFileSync(join(directory, file), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    }));
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'preparation-counters-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

describe('bounded preparation counters', () => {
  it('distinguishes repeated reads of one owner from inventory progress and encoding', () => {
    const result = withPreparationCounters({ directory, sessionId: 'example-session' }, () => {
      preparationOwnerRead({ ordinal: 1, total: 2, name: 'Alpha', phase: 'inventory' }, () => {
        countPreparation('sourceOpens');
        preparationOperation('source-digest', () => {
          countPreparation('digestPasses');
          countPreparation('digestFragments', 2048);
          countPreparation('digestCompletions');
        });
        countPreparation('sourceOpenCompletions');
      });
      countPreparation('ownersCompleted');
      preparationOwnerRead({ ordinal: 1, total: 2, name: 'Alpha', phase: 'component-encoding' }, () => {});
      preparationOwnerRead({ ordinal: 2, total: 2, name: 'Beta', phase: 'inventory' }, () => {});
      countPreparation('ownersCompleted');
      return 42;
    });
    expect(result).toBe(42);
    const [{ file, events }] = reports();
    expect(statSync(join(directory, file)).mode & 0o777).toBe(0o600);
    expect(
      events
        .filter((event) => event.event === 'operation-start' && event.operation === 'owner-read')
        .map((event) => [event.owner.ordinal, event.owner.phase]),
    ).toEqual([
      [1, 'inventory'],
      [1, 'component-encoding'],
      [2, 'inventory'],
    ]);
    expect(events.at(-1)?.owner).toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      event: 'complete',
      counters: {
        ownerReads: 3,
        ownerReadCompletions: 3,
        ownersCompleted: 2,
        sourceOpens: 1,
        sourceOpenCompletions: 1,
        digestPasses: 1,
        digestCompletions: 1,
        digestFragments: 2048,
      },
    });
  });

  it('emits progress during synchronous work and throttles hot-loop logging', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const activity = vi.fn();
    withPreparationCounters({ directory, sessionId: 'example-session', onActivity: activity }, () => {
      for (let index = 0; index < 4096; index++) countPreparation('fileReads');
      now = 6000;
      countPreparation('digestFragments', 1024);
      for (let index = 0; index < 4096; index++) countPreparation('authorityChecks');
    });
    const [{ events }] = reports();
    expect(events.map((event) => event.event)).toEqual(['start', 'progress', 'complete']);
    expect(events[1]).toMatchObject({ elapsedMs: 6000, counters: { fileReads: 4096, digestFragments: 1024 } });
    expect(activity).toHaveBeenCalledTimes(3);
  });

  it('preserves errors and records the failed operation without private error text', () => {
    const failure = new Error('private source contents');
    expect(() =>
      withPreparationCounters({ directory, sessionId: 'example-session' }, () =>
        preparationOperation('catalog-build', () => {
          countPreparation('catalogBuilds');
          throw failure;
        }),
      ),
    ).toThrow(failure);
    const [{ events }] = reports();
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ event: 'operation-failed', operation: 'catalog-build' })]),
    );
    expect(events.at(-1)).toMatchObject({ event: 'failed', counters: { catalogBuilds: 1, catalogCompletions: 0 } });
    expect(JSON.stringify(events)).not.toContain(failure.message);
  });

  it('does not change results when filesystem or observer logging fails', () => {
    const path = join(directory, 'regular-file');
    writeFileSync(path, '');
    expect(withPreparationCounters({ directory: path, sessionId: 'example-session' }, () => 7)).toBe(7);
    expect(
      withPreparationCounters(
        {
          directory,
          sessionId: 'example-session',
          onActivity: () => {
            throw Error('observer');
          },
        },
        () => {
          rmSync(directory, { recursive: true });
          return 9;
        },
      ),
    ).toBe(9);
  });

  it('restores outer counter scopes and is inert outside an operation', () => {
    countPreparation('sourceOpens');
    expect(preparationOperation('disabled', () => 1)).toBe(1);
    expect(reports()).toHaveLength(0);
    withPreparationCounters({ directory, sessionId: 'outer' }, () => {
      countPreparation('sourceOpens');
      withPreparationCounters({ directory, sessionId: 'inner' }, () => countPreparation('sourceOpens', 3));
      countPreparation('sourceOpens');
    });
    expect(
      reports()
        .map(({ events }) => [events[0].sessionId, events.at(-1).counters.sourceOpens])
        .sort(),
    ).toEqual([
      ['inner', 3],
      ['outer', 2],
    ]);
  });
});
