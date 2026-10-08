import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureRefineSession } from '../../src/review-session/repositories/ensure-review-session.js';
import { getRefineSessionPaths } from '../../src/review-session/repositories/review-session-paths.js';
import { saveReviewState } from '../../src/review-session/repositories/save-review-state.js';
import type { ReviewSessionSnapshot } from '../../src/review-session/types/review-session.js';

const emptySnapshot: ReviewSessionSnapshot = { components: [] };

describe('ensureRefineSession', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ensure-refine-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the initial snapshot on first call', async () => {
    const snapshot = await ensureRefineSession('sid', dir, emptySnapshot);
    expect(snapshot).toEqual(emptySnapshot);
    const paths = await getRefineSessionPaths('sid', dir);
    const written = JSON.parse(readFileSync(paths.statePath, 'utf8'));
    expect(written).toEqual(emptySnapshot);
  });

  it('returns the existing on-disk snapshot on subsequent calls', async () => {
    const paths = await getRefineSessionPaths('sid', dir);
    await ensureRefineSession('sid', dir, emptySnapshot);
    const edited: ReviewSessionSnapshot = {
      components: [
        {
          id: 'x',
          name: 'X',
          resolvedSourcePath: '/x',
          sourceCode: null,
          originalProposal: { name: 'X', source: 'x', framework: 'react', props: [], slots: [] },
          editedProposal: { name: 'X', source: 'x', framework: 'react', props: [], slots: [] },
          status: 'accepted',
        },
      ],
    };
    await saveReviewState(paths.statePath, edited);
    const reloaded = await ensureRefineSession('sid', dir, emptySnapshot);
    expect(reloaded.components).toHaveLength(1);
    expect(reloaded.components[0]!.name).toBe('X');
  });
});
