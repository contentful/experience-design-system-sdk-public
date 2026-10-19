import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pruneExpiredLogs } from '../src/tui/debug-prune.js';

const DAY_S = 24 * 60 * 60;
let base: string;

afterEach(() => rmSync(base, { recursive: true, force: true }));

function file(path: string, ageDays: number): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, 'x');
  const when = Date.now() / 1000 - ageDays * DAY_S;
  utimesSync(path, when, when);
  return path;
}

// Deleting files is the one thing in the logger that can lose data, so the boundary is what is tested: expired logs go,
// and nothing else does.
describe('pruning expired debug logs', () => {
  it('deletes only logs older than the retention, and never anything outside a session debug folder', async () => {
    base = mkdtempSync(join(tmpdir(), 'eds-prune-'));
    const session = join(base, '.contentful', '01-05-2026-session-1');
    const oldLog = file(join(session, 'debug', 'settings', 'old-attempt-1.md'), 45);
    const newLog = file(join(session, 'debug', 'settings', 'new-attempt-1.md'), 5);
    const oldImportOutput = file(join(session, 'dsi-import-1', 'components.json'), 400);
    const oldNote = file(join(session, 'debug', 'notes.txt'), 400);
    const oldOutsideSessions = file(join(base, '.contentful', 'keep-me.md'), 400);

    const deleted = await pruneExpiredLogs(base, 30);

    expect(deleted).toBe(1);
    expect(existsSync(oldLog)).toBe(false);
    for (const kept of [newLog, oldImportOutput, oldNote, oldOutsideSessions]) expect(existsSync(kept)).toBe(true);
  });
});
