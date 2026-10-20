import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readSettings, updateSettings, writeSettings } from '../../src/config/index.js';
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'settings-integrity-'));
  vi.stubEnv('EDS_HOME', root);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
it.each(['malformed', 'directory'])('rejects %s settings with path and preserves data during updates', async (kind) => {
  const path = join(root, 'config.json');
  if (kind === 'directory') mkdirSync(path);
  else writeFileSync(path, '{ retained broken settings');
  await expect(readSettings()).rejects.toThrow(path);
  await expect(updateSettings({ spaceId: 'example' })).rejects.toThrow(path);
  if (kind === 'malformed') expect(readFileSync(path, 'utf8')).toBe('{ retained broken settings');
});
it('initializes missing settings and preserves unrelated false preferences with private atomic writes', async () => {
  expect(await readSettings()).toEqual({});
  await writeSettings({ analyticsDisabled: false, debugMode: { enabled: false }, spaceId: 'example' });
  await updateSettings({ environmentId: 'preview' });
  expect(await readSettings()).toEqual({
    analyticsDisabled: false,
    debugMode: { enabled: false },
    spaceId: 'example',
    environmentId: 'preview',
  });
  expect(statSync(join(root, 'config.json')).mode & 0o777).toBe(0o600);
});
