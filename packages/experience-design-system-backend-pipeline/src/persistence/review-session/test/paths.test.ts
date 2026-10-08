import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getRefineArtifactsRoot } from '../paths/review-artifacts-root.js';
import { getRefineSessionPaths } from '../paths/review-session-paths.js';

describe('review-session paths', () => {
  const prevEdsHome = process.env['EDS_HOME'];
  const prevReview = process.env['EDS_REVIEW_ARTIFACTS_DIR'];
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'review-paths-'));
    process.env['EDS_HOME'] = home;
    delete process.env['EDS_REVIEW_ARTIFACTS_DIR'];
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (prevEdsHome === undefined) delete process.env['EDS_HOME'];
    else process.env['EDS_HOME'] = prevEdsHome;
    if (prevReview === undefined) delete process.env['EDS_REVIEW_ARTIFACTS_DIR'];
    else process.env['EDS_REVIEW_ARTIFACTS_DIR'] = prevReview;
  });

  it('defaults artifacts root to configRoot/reviews', () => {
    expect(getRefineArtifactsRoot()).toBe(resolve(home, 'reviews'));
  });

  it('respects EDS_REVIEW_ARTIFACTS_DIR override', () => {
    process.env['EDS_REVIEW_ARTIFACTS_DIR'] = '/tmp/custom';
    expect(getRefineArtifactsRoot()).toBe(resolve('/tmp/custom'));
  });

  it('derives sessionDir, eventsPath, statePath from sessionId + artifactsRoot', async () => {
    const paths = await getRefineSessionPaths('abc-123', '/tmp/base');
    expect(paths.sessionDir).toBe('/tmp/base/abc-123');
    expect(paths.eventsPath).toBe('/tmp/base/abc-123/events.jsonl');
    expect(paths.statePath).toBe('/tmp/base/abc-123/current-review-state.json');
  });
});
