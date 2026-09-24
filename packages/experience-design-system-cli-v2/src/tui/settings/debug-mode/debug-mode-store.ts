import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { findPackageRoot } from '../../package-root.js';

const PACKAGE_NAME = '@contentful/experience-design-system-cli-v2';

export type DebugModeSetting = {
  enabled: boolean;
};

export const DEFAULT_DEBUG_MODE_SETTING: DebugModeSetting = {
  enabled: true,
};

export function debugModeSettingPath(): string {
  return join(findPackageRoot(import.meta.url, PACKAGE_NAME), '.contentful', 'config', 'debug_mode.json');
}

export async function readDebugModeSetting(): Promise<DebugModeSetting> {
  try {
    const raw = await readFile(debugModeSettingPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<DebugModeSetting>;
    return { ...DEFAULT_DEBUG_MODE_SETTING, ...parsed };
  } catch {
    return { ...DEFAULT_DEBUG_MODE_SETTING };
  }
}

export async function writeDebugModeSetting(setting: DebugModeSetting): Promise<void> {
  const path = debugModeSettingPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(setting, null, 2)}\n`, { mode: 0o600 });
}
