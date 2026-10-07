import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rmdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  oldConfigDir,
  readSettings,
  runsFilePath,
  updateSettings,
} from '@contentful/experience-design-system-types/config';
import { findPackageRoot } from '../tui/package-root.js';

const PACKAGE_NAME = '@contentful/experience-design-system-cli';

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

// One-time move of settings from where earlier versions kept them (~/.config/experiences/ and the
// package folder) into the consolidated config. Values already present in the new config win. Each
// original is deleted only after its contents are safely in the new location. Never throws: a failed
// migration must not stop the CLI from starting.
export async function migrateOldConfig(): Promise<void> {
  try {
    const oldCredentials = join(oldConfigDir(), 'credentials.json');
    const oldRuns = join(oldConfigDir(), 'runs.json');
    const oldDebugMode = join(
      findPackageRoot(import.meta.url, PACKAGE_NAME),
      '.contentful',
      'config',
      'debug_mode.json',
    );

    const migrated: Record<string, unknown> = {};
    const debugMode = await readJson(oldDebugMode);
    if (debugMode) migrated['debugMode'] = debugMode;
    Object.assign(migrated, await readJson(oldCredentials));
    if (Object.keys(migrated).length > 0) await updateSettings({ ...migrated, ...(await readSettings()) });

    if (existsSync(oldRuns)) {
      if (!existsSync(runsFilePath())) {
        await mkdir(dirname(runsFilePath()), { recursive: true });
        await rename(oldRuns, runsFilePath());
      } else {
        await unlink(oldRuns);
      }
    }

    await Promise.all([oldCredentials, oldDebugMode].map((f) => unlink(f).catch(() => undefined)));
    await rmdir(oldConfigDir()).catch(() => undefined);
  } catch {
    // Fail open.
  }
}
