import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEBUG_SESSION_DIR_ENV, startPushDebugRun } from '../../src/lib/push-debug-log.js';

describe('startPushDebugRun', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'push-debug-'));
  });

  afterEach(() => {
    delete process.env[DEBUG_SESSION_DIR_ENV];
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes nothing when the v2 CLI did not set a session directory', () => {
    startPushDebugRun({ space_id: 's' }).finish({ ok: true }, 'success');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('writes a push log with inputs and outputs under <session>/import', () => {
    process.env[DEBUG_SESSION_DIR_ENV] = dir;
    startPushDebugRun({ space_id: 'space1', cdf_keys: ['Button'] }).finish(
      { operation_status: 'succeeded', item_count: 1 },
      'success',
    );

    const files = readdirSync(join(dir, 'import'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{2}-\d{2}-\d{4}-push-attempt-1\.md$/);

    const content = readFileSync(join(dir, 'import', files[0]!), 'utf8');
    expect(content).toContain('- Step: 01 - push');
    expect(content).toContain('- Status: success');
    expect(content).toContain('"space_id": "space1"');
    expect(content).toContain('"operation_status": "succeeded"');
  });

  it('redacts the CMA token', () => {
    process.env[DEBUG_SESSION_DIR_ENV] = dir;
    startPushDebugRun({ cma_token: 'CFPAT-abcdefghijklmnopqrstuvwxyz0123456789' }).finish({}, 'success');

    const files = readdirSync(join(dir, 'import'));
    const content = readFileSync(join(dir, 'import', files[0]!), 'utf8');
    expect(content).toContain('[present, 42 chars]');
    expect(content).not.toContain('CFPAT-abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('numbers repeat pushes and only writes once per run', () => {
    process.env[DEBUG_SESSION_DIR_ENV] = dir;
    const first = startPushDebugRun({});
    first.finish({}, 'error');
    first.finish({}, 'error');
    startPushDebugRun({}).finish({}, 'success');

    const files = readdirSync(join(dir, 'import')).sort();
    expect(files).toHaveLength(2);
    expect(files[1]).toMatch(/push-attempt-2\.md$/);
  });
});
