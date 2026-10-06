import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// The single source of truth for where the CLI keeps files on disk and how settings are read and written.
// The CLI and the bundled legacy import both use this; nothing else calls homedir() or touches these files.
//
// ~/.contentful/experience-design-system-cli/
//   config.json    every setting: credentials, preferences, debug mode (mode 0600)    [CLI]
//   debug/         per-session debug logs                                              [CLI]
//   state/         runs.json, run history                                              [legacy, until deleted]
//   reviews/       review artifacts                                                    [legacy, until deleted]
//   pipeline.db    session database, including the generation cache                    [legacy, until deleted]
export function configRoot(): string {
  return process.env['EDS_HOME'] || join(homedir(), '.contentful', 'experience-design-system-cli');
}

export const configFilePath = (): string => join(configRoot(), 'config.json');
export const runsFilePath = (): string => join(configRoot(), 'state', 'runs.json');
export const debugSessionsDir = (): string => join(configRoot(), 'debug', 'sessions');

export type Settings = Record<string, unknown>;

export async function readSettings(): Promise<Settings> {
  try {
    return JSON.parse(await readFile(configFilePath(), 'utf8')) as Settings;
  } catch {
    return {};
  }
}

// Write-then-rename so a crash can never leave a half-written config.
export async function writeSettings(settings: Settings): Promise<void> {
  const path = configFilePath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

export async function updateSettings(patch: Settings): Promise<void> {
  await writeSettings({ ...(await readSettings()), ...patch });
}

// Directory the config used to live in; only the migration reads from it.
export const oldConfigDir = (): string => join(homedir(), '.config', 'experiences');
