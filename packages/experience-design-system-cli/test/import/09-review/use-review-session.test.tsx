import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import {
  getOrCreateSession,
  openPipelineDb,
  storeCDFComponents,
  storeRawComponents,
} from '@contentful/experience-design-system-backend-pipeline';
import {
  useReviewHistory,
  useReviewMetadata,
  useReviewSession,
} from '../../../src/tui/import/steps/09-review/use-review-session.js';
import {
  createReviewHistorySnapshot,
  type ReviewSessionLoadResult,
} from '../../../src/tui/import/steps/09-review/session.js';
import type { HistorySnapshot } from '../../../src/tui/import/steps/09-review/history.js';
import type { CdfReviewEntry } from '../../../src/tui/import/steps/09-review/types.js';

const entry: CDFComponentEntry = { $type: 'component', $properties: {} };
const review = (key: string, status: CdfReviewEntry['status'] = 'needs-review'): CdfReviewEntry => ({
  key,
  entry,
  status,
});
const loaded = (overrides: Partial<ReviewSessionLoadResult> = {}): ReviewSessionLoadResult => ({
  entries: [review('Button')],
  tokens: [{ path: 'color.from.db', kind: 'color' }],
  error: null,
  ...overrides,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function mount<T>(useHook: () => T): { current: T } {
  const ref: { current: T | null } = { current: null };
  function Probe(): React.ReactElement {
    ref.current = useHook();
    return React.createElement(Text, null, '');
  }
  render(React.createElement(Probe));
  return ref as { current: T };
}

describe('useReviewSession', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'review-hook-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('is loading first, then has the components and the tokens the session read', async () => {
    const loadSession = vi.fn(() => loaded());
    const hook = mount(() => useReviewSession({ loadSession }));
    expect(hook.current.loading).toBe(true);

    await settle();

    expect(hook.current.loading).toBe(false);
    expect(hook.current.loadError).toBeNull();
    expect(hook.current.components.map((c) => c.key)).toEqual(['Button']);
    expect(hook.current.availableTokens).toEqual([{ path: 'color.from.db', kind: 'color' }]);
  });

  it('shows the error and no components when the session has none', async () => {
    const loadSession = vi.fn(() => loaded({ entries: [], tokens: [], error: 'No generated definitions found' }));
    const hook = mount(() => useReviewSession({ loadSession }));

    await settle();

    expect(hook.current.loadError).toBe('No generated definitions found');
    expect(hook.current.components).toEqual([]);
    expect(hook.current.loading).toBe(false);
  });

  it('shows a failure to load as an error instead of throwing', async () => {
    const loadSession = vi.fn(() => {
      throw new Error('database is locked');
    });
    const hook = mount(() => useReviewSession({ loadSession }));

    await settle();

    expect(hook.current.loadError).toContain('database is locked');
    expect(hook.current.loading).toBe(false);
  });

  it('takes the token catalog from the tokens file when there is one, instead of from the session', async () => {
    const tokensPath = join(dir, 'tokens.json');
    await writeFile(tokensPath, JSON.stringify({ color: { brand: { $type: 'color', $value: '#06f' } } }));
    const loadSession = vi.fn(() => loaded());
    const hook = mount(() => useReviewSession({ loadSession, tokensPath }));

    await settle();

    expect(hook.current.availableTokens).toEqual([{ path: 'color.brand', kind: 'color' }]);
  });

  it('shows an unreadable tokens file as an error', async () => {
    const loadSession = vi.fn(() => loaded());
    const hook = mount(() => useReviewSession({ loadSession, tokensPath: join(dir, 'missing.json') }));

    await settle();

    expect(hook.current.loadError).not.toBeNull();
    expect(hook.current.components).toEqual([]);
  });

  it('hands the extra the session read to onExtraLoaded', async () => {
    const onExtraLoaded = vi.fn();
    const loadSession = vi.fn(() => loaded({ extra: undefined }));
    mount(() => useReviewSession({ loadSession, onExtraLoaded }));

    await settle();

    expect(onExtraLoaded).toHaveBeenCalledTimes(1);
  });

  it('reloads from the saved state, replacing the components and the catalog with what was saved', async () => {
    let result = loaded();
    const loadSession = vi.fn(() => result);
    const hook = mount(() => useReviewSession({ loadSession }));
    await settle();

    result = loaded({ entries: [review('Card', 'accepted')], tokens: [{ path: 'color.new', kind: 'color' }] });
    const returned = hook.current.reloadFromSave();
    await settle();

    expect(returned).toBe(result);
    expect(hook.current.components.map((c) => c.key)).toEqual(['Card']);
    expect(hook.current.availableTokens).toEqual([{ path: 'color.new', kind: 'color' }]);
  });

  it('keeps what is on screen when a reload finds an error, and says so', async () => {
    let result = loaded();
    const loadSession = vi.fn(() => result);
    const hook = mount(() => useReviewSession({ loadSession }));
    await settle();

    result = loaded({ entries: [], error: 'gone' });
    expect(hook.current.reloadFromSave()).toBeNull();
    await settle();

    expect(hook.current.loadError).toBe('gone');
    expect(hook.current.components.map((c) => c.key)).toEqual(['Button']);
  });
});

describe('useReviewHistory', () => {
  const setup = (components: CdfReviewEntry[], loading = false) => {
    const applied: HistorySnapshot[] = [];
    const hook = mount(() =>
      useReviewHistory({
        loading,
        components,
        createSnapshot: (entries) => createReviewHistorySnapshot(entries),
        applySnapshot: (snapshot) => applied.push(snapshot),
      }),
    );
    return { hook, applied };
  };
  const keys = (snapshot: HistorySnapshot | undefined) => snapshot?.components.map((c) => `${c.key}:${c.status}`);

  it('has nothing to undo until the first change', async () => {
    const { hook, applied } = setup([review('A')]);
    await settle();

    hook.current.handleUndo();

    expect(applied).toEqual([]);
  });

  it('is not seeded while the review is still loading', async () => {
    const { hook } = setup([review('A')], true);
    await settle();

    expect(hook.current.historySeededRef.current).toBe(false);
  });

  it('undoes to the state before a change and redoes it again', async () => {
    const { hook, applied } = setup([review('A')]);
    await settle();

    hook.current.pushHistorySnapshot([review('A', 'accepted')], 'accept');
    hook.current.handleUndo();
    hook.current.handleRedo();

    expect(applied.map(keys)).toEqual([['A:needs-review'], ['A:accepted']]);
  });

  it('drops the redo steps when a new change is made after an undo', async () => {
    const { hook, applied } = setup([review('A')]);
    await settle();
    hook.current.pushHistorySnapshot([review('A', 'accepted')], 'accept');
    hook.current.handleUndo();

    hook.current.pushHistorySnapshot([review('A', 'rejected')], 'reject');
    hook.current.handleRedo();

    expect(applied.map(keys)).toEqual([['A:needs-review']]);
  });

  it('starts over from a snapshot when reset', async () => {
    const { hook, applied } = setup([review('A')]);
    await settle();
    hook.current.pushHistorySnapshot([review('A', 'accepted')], 'accept');

    hook.current.resetHistory(createReviewHistorySnapshot([review('A', 'rejected')]));
    hook.current.handleUndo();

    expect(applied).toEqual([]);
  });

  it('ignores a change pushed before it was seeded', () => {
    const { hook, applied } = setup([review('A')], true);

    hook.current.pushHistorySnapshot([review('A', 'accepted')], 'accept');
    hook.current.handleUndo();

    expect(applied).toEqual([]);
  });
});

describe('useReviewMetadata', () => {
  let dir: string;
  let previousDbPath: string | undefined;
  let sessionId: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'review-metadata-'));
    previousDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'pipeline.db');
    const db = openPipelineDb();
    sessionId = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' }).sessionId;
    storeRawComponents(db, sessionId, [
      { name: 'Button', source: 'src/Button.tsx', framework: 'react', props: [], slots: [] },
    ]);
    storeCDFComponents(db, sessionId, [{ key: 'Button', entry }]);
    db.close();
  });
  afterEach(async () => {
    if (previousDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  });

  it('has no metadata or rationale when nothing is selected', async () => {
    const hook = mount(() => useReviewMetadata({ components: [], selectedIdx: 0, extractSessionId: sessionId }));
    await settle();

    expect(hook.current).toEqual({ reviewMetadata: null, componentRationale: null });
  });

  it('reads the rationale of the selected component, which is empty when none was saved', async () => {
    const hook = mount(() =>
      useReviewMetadata({ components: [review('Button')], selectedIdx: 0, extractSessionId: sessionId }),
    );
    await settle();

    expect(hook.current.componentRationale).toMatchObject({ name: 'Button', props: [], slots: [] });
  });

  it('reads nothing for a component the session does not have, without failing', async () => {
    const hook = mount(() =>
      useReviewMetadata({ components: [review('Ghost')], selectedIdx: 0, extractSessionId: sessionId }),
    );
    await settle();

    expect(hook.current.reviewMetadata).toBeNull();
  });
});
