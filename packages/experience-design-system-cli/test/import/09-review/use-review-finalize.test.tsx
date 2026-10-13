import { mkdtemp, rm } from 'node:fs/promises';
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
  storeRawComponents,
} from '@contentful/experience-design-system-backend-pipeline';
import type { CdfReviewEntry } from '../../../src/tui/import/steps/09-review/types.js';

const finalizePreviewOptions: Array<Record<string, unknown>> = [];
const previewResult = { status: 'done' as const, removed: [], scrollOffset: 0, scrollBy: vi.fn() };

vi.mock('../../../src/tui/import/steps/09-review/use-finalize-preview.js', () => ({
  useReviewFinalizePreview: (options: Record<string, unknown>) => {
    finalizePreviewOptions.push(options);
    return previewResult;
  },
}));

const { useReviewFinalize } = await import('../../../src/tui/import/steps/09-review/use-review-session.js');

const entry: CDFComponentEntry = { $type: 'component', $properties: {} };
const review = (key: string, status: CdfReviewEntry['status']): CdfReviewEntry => ({ key, entry, status });

describe('useReviewFinalize', () => {
  let dir: string;
  let previousDbPath: string | undefined;
  let sessionId: string;
  const unmounts: Array<() => void> = [];

  const statuses = (): Record<string, string> => {
    const db = openPipelineDb();
    try {
      const rows = db.prepare('SELECT name, status FROM raw_components WHERE session_id = ?').all(sessionId) as Array<{
        name: string;
        status: string;
      }>;
      return Object.fromEntries(rows.map((row) => [row.name, row.status]));
    } finally {
      db.close();
    }
  };

  beforeEach(async () => {
    finalizePreviewOptions.length = 0;
    dir = await mkdtemp(join(tmpdir(), 'review-finalize-'));
    previousDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'pipeline.db');
    const db = openPipelineDb();
    sessionId = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' }).sessionId;
    storeRawComponents(
      db,
      sessionId,
      ['Accepted', 'Rejected1', 'Rejected2', 'Unresolved1', 'Unresolved2', 'Unresolved3'].map((name) => ({
        name,
        source: `src/${name}.tsx`,
        framework: 'react' as const,
        props: [],
        slots: [],
      })),
    );
    db.prepare(`UPDATE raw_components SET status = 'generated' WHERE session_id = ?`).run(sessionId);
    db.close();
  });

  afterEach(async () => {
    for (const unmount of unmounts.splice(0)) unmount();
    if (previousDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  });

  const mount = (overrides: Record<string, unknown> = {}) => {
    const onFinalize = vi.fn();
    const ref: { current: ReturnType<typeof useReviewFinalize> | null } = { current: null };
    // Distinct counts, so a swapped pair of arguments is visible: 1 accepted, 2 rejected, 3 unresolved.
    const components = [
      review('Accepted', 'accepted'),
      review('Rejected1', 'rejected'),
      review('Rejected2', 'rejected'),
      review('Unresolved1', 'needs-review'),
      review('Unresolved2', 'needs-review'),
      review('Unresolved3', 'needs-review'),
    ];
    function Probe(): React.ReactElement {
      ref.current = useReviewFinalize({
        showFinalize: true,
        extractSessionId: sessionId,
        tokensPath: '/t.json',
        spaceId: 'sp',
        environmentId: 'master',
        cmaToken: 'token',
        host: 'h',
        components,
        onFinalize,
        ...overrides,
      });
      return <Text>-</Text>;
    }
    unmounts.push(render(<Probe />).unmount);
    return { hook: () => ref.current!, onFinalize };
  };

  it("gives the dialog's preview the credentials, the session and the review's components", () => {
    mount();

    expect(finalizePreviewOptions[0]).toMatchObject({
      open: true,
      extractSessionId: sessionId,
      tokensPath: '/t.json',
      spaceId: 'sp',
      environmentId: 'master',
      cmaToken: 'token',
      host: 'h',
      components: [
        { key: 'Accepted', status: 'accepted' },
        { key: 'Rejected1', status: 'rejected' },
        { key: 'Rejected2', status: 'rejected' },
        { key: 'Unresolved1', status: 'needs-review' },
        { key: 'Unresolved2', status: 'needs-review' },
        { key: 'Unresolved3', status: 'needs-review' },
      ],
    });
  });

  it('keeps the preview closed while the dialog is closed', () => {
    mount({ showFinalize: false });

    expect(finalizePreviewOptions[0]).toMatchObject({ open: false });
  });

  it('returns the dialog preview, so the screen can show the removed list', () => {
    expect(mount().hook().finalizePreview).toBe(previewResult);
  });

  describe('confirming', () => {
    it('rejects what was rejected and what was never decided in the database, and keeps what was accepted', () => {
      const { hook } = mount();

      hook().handleFinalizeConfirm();

      expect(statuses()).toEqual({
        Accepted: 'generated',
        Rejected1: 'generate-rejected',
        Rejected2: 'generate-rejected',
        Unresolved1: 'generate-rejected',
        Unresolved2: 'generate-rejected',
        Unresolved3: 'generate-rejected',
      });
    });

    it('reports the counts back to the wizard', () => {
      const { hook, onFinalize } = mount();

      hook().handleFinalizeConfirm();

      expect(onFinalize).toHaveBeenCalledExactlyOnceWith(1, 2, 3);
    });

    it('does nothing until it is confirmed', () => {
      const { onFinalize } = mount();

      expect(onFinalize).not.toHaveBeenCalled();
      expect(Object.values(statuses())).toEqual(Array(6).fill('generated'));
    });
  });
});
