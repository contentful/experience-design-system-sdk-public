import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const paths = vi.hoisted(() => ({ old: '', pkg: '' }));
vi.mock('@contentful/experience-design-system-types/config', async (original) => ({
  ...(await original<object>()),
  oldConfigDir: () => paths.old,
}));
vi.mock('../src/tui/package-root.js', () => ({ findPackageRoot: () => paths.pkg }));
import { readSettings, writeSettings } from '@contentful/experience-design-system-types/config';
import { writeCredentials } from '../src/tui/settings/contentful-configuration/config-store.js';
import { migrateOldConfig } from '../src/config/migrate.js';
let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'config-consumers-'));
  vi.stubEnv('EDS_HOME', join(root, 'current'));
  paths.old = join(root, 'old');
  paths.pkg = join(root, 'pkg');
  mkdirSync(paths.old);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});
it('configuration saves preserve false preferences while removing only supplied empty configuration fields', async () => {
  await writeSettings({ analyticsDisabled: false, debug: false, debugMode: { enabled: false }, spaceId: 'example' });
  await writeCredentials({ spaceId: '', environmentId: 'preview' });
  expect(await readSettings()).toEqual({
    analyticsDisabled: false,
    debug: false,
    debugMode: { enabled: false },
    environmentId: 'preview',
  });
});
it('migration warns and retains malformed legacy files without writing settings', async () => {
  const old = join(paths.old, 'credentials.json');
  writeFileSync(old, '{ retained broken');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(migrateOldConfig()).resolves.toBeUndefined();
  expect(warning).toHaveBeenCalledWith(expect.stringContaining(old));
  expect(readFileSync(old, 'utf8')).toBe('{ retained broken');
  expect(existsSync(join(root, 'current/config.json'))).toBe(false);
});
it('migration reports damaged current settings and preserves both sources', async () => {
  const old = join(paths.old, 'credentials.json');
  writeFileSync(old, JSON.stringify({ spaceId: 'example' }));
  mkdirSync(join(root, 'current'));
  const current = join(root, 'current/config.json');
  writeFileSync(current, '{ retained current');
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await migrateOldConfig();
  expect(warning).toHaveBeenCalledWith(expect.stringContaining(current));
  expect(existsSync(old)).toBe(true);
  expect(readFileSync(current, 'utf8')).toBe('{ retained current');
});
