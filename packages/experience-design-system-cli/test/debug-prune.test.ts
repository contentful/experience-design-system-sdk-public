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

// Deleting files and folders is the one thing in the logger that can lose data, so the boundary is what is tested:
// expired logs go, folders they leave empty go, and nothing else does.
describe('pruning expired debug logs', () => {
  it('deletes only expired logs and the folders that leaves empty, never anything else', async () => {
    base = mkdtempSync(join(tmpdir(), 'eds-prune-'));
    const contentful = join(base, '.contentful');

    // Only expired logs: the whole session folder is left empty and goes.
    const onlyOld = join(contentful, '01-05-2026-session-1');
    file(join(onlyOld, 'debug', 'settings', 'old-attempt-1.md'), 45);

    // An expired and a current log: only the expired file goes.
    const mixed = join(contentful, '01-06-2026-session-1');
    const oldLog = file(join(mixed, 'debug', 'settings', 'old-attempt-1.md'), 45);
    const newLog = file(join(mixed, 'debug', 'settings', 'new-attempt-1.md'), 5);

    // Expired logs next to import output: the debug folders go, the session folder and its import output stay.
    const withImport = join(contentful, '01-07-2026-session-1');
    file(join(withImport, 'debug', 'settings', 'old-attempt-1.md'), 45);
    const importOutput = file(join(withImport, 'dsi-import-1', 'components.json'), 400);

    // Not a debug log, and not a session folder: untouched however old.
    const note = file(join(mixed, 'debug', 'notes.txt'), 400);
    const outside = file(join(contentful, 'keep-me.md'), 400);

    const deleted = await pruneExpiredLogs(base, 30);

    expect(deleted).toBe(3);
    expect(existsSync(onlyOld)).toBe(false);
    expect(existsSync(oldLog)).toBe(false);
    expect(existsSync(join(withImport, 'debug'))).toBe(false);
    for (const kept of [newLog, importOutput, note, outside]) expect(existsSync(kept)).toBe(true);
  });
});
