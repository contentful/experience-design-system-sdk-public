import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRun } from '../../src/runs/services/append-run.js';
import { listRuns } from '../../src/runs/services/list-runs.js';
import { getRun } from '../../src/runs/services/get-run.js';
import { updateRun } from '../../src/runs/services/update-run.js';
import { generateUlid } from '../../src/runs/helpers/generate-ulid.js';
import { buildTimestampedSubdir } from '../../src/runs/helpers/build-timestamped-subdir.js';
import { detectSaveConflict } from '../../src/runs/services/detect-save-conflict.js';
import { writeFileSync, mkdirSync } from 'node:fs';

describe('runs ledger', () => {
  let home: string;
  const prev = process.env['EDS_HOME'];
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'runs-'));
    process.env['EDS_HOME'] = home;
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (prev === undefined) delete process.env['EDS_HOME'];
    else process.env['EDS_HOME'] = prev;
  });

  it('appends and lists runs with newest-first ordering', async () => {
    await appendRun({
      projectPath: '/a',
      savePath: '/out',
      componentCount: 1,
      tokenCount: 0,
      tokensPath: null,
      tokenSessionId: null,
      agent: 'claude',
      pushedTo: null,
      extractSessionId: 'ex-1',
      generateSessionId: null,
    });
    await appendRun({
      projectPath: '/b',
      savePath: '/out',
      componentCount: 2,
      tokenCount: 0,
      tokensPath: null,
      tokenSessionId: null,
      agent: 'claude',
      pushedTo: null,
      extractSessionId: 'ex-2',
      generateSessionId: null,
    });
    const list = await listRuns();
    expect(list).toHaveLength(2);
    expect(list[0]!.projectPath).toBe('/b');
    expect(list[1]!.projectPath).toBe('/a');
  });

  it('filters by projectPath', async () => {
    await appendRun({
      projectPath: '/a',
      savePath: '/out',
      componentCount: 1,
      tokenCount: 0,
      tokensPath: null,
      tokenSessionId: null,
      agent: 'claude',
      pushedTo: null,
      extractSessionId: 'ex-1',
      generateSessionId: null,
    });
    const list = await listRuns({ projectPath: '/missing' });
    expect(list).toEqual([]);
  });

  it('getRun throws for unknown id', async () => {
    await expect(getRun('nope')).rejects.toThrow(/not found/);
  });

  it('updateRun merges a patch while keeping the id', async () => {
    const r = await appendRun({
      projectPath: '/x',
      savePath: '/out',
      componentCount: 1,
      tokenCount: 0,
      tokensPath: null,
      tokenSessionId: null,
      agent: 'claude',
      pushedTo: null,
      extractSessionId: 'ex-1',
      generateSessionId: null,
    });
    const updated = await updateRun(r.id, { componentCount: 5, notes: 'hi' });
    expect(updated.id).toBe(r.id);
    expect(updated.componentCount).toBe(5);
    expect(updated.notes).toBe('hi');
  });

  it('generateUlid returns 26 crockford chars', () => {
    const u = generateUlid();
    expect(u).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('buildTimestampedSubdir uses dsi-YYYYMMDD-HHMMSS format', () => {
    const d = new Date(2026, 9, 8, 14, 5, 9);
    expect(buildTimestampedSubdir('/base', d)).toBe('/base/dsi-20261008-140509');
  });

  it('detectSaveConflict is true when components.json exists', async () => {
    const dir = join(home, 'save');
    mkdirSync(dir);
    writeFileSync(join(dir, 'components.json'), '{}');
    expect(await detectSaveConflict(dir)).toBe(true);
  });

  it('detectSaveConflict is false for an empty dir', async () => {
    const dir = join(home, 'save-empty');
    mkdirSync(dir);
    expect(await detectSaveConflict(dir)).toBe(false);
  });
});
