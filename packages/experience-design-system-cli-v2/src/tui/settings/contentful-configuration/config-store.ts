import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Adapter to read/write v1's shared credentials store.
 * V2's configuration screen uses this to manage Contentful credentials
 * that are shared with v1's import and setup flows.
 */

export type V1Credentials = {
  spaceId?: string;
  environmentId?: string;
  cmaToken?: string;
  host?: string;
  [key: string]: string | undefined;
};

export const EMPTY_CREDENTIALS: V1Credentials = {
  spaceId: '',
  environmentId: '',
  cmaToken: '',
  host: '',
};

const CREDENTIALS_DIR = join(homedir(), '.config', 'experiences');
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, 'credentials.json');

export async function readCredentials(): Promise<V1Credentials> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as V1Credentials;
    return {
      spaceId: parsed.spaceId || '',
      environmentId: parsed.environmentId || '',
      cmaToken: parsed.cmaToken || '',
      host: parsed.host || '',
    };
  } catch {
    return { ...EMPTY_CREDENTIALS };
  }
}

export async function writeCredentials(config: V1Credentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });

  // Read any existing config to preserve non-credential fields
  let existing: V1Credentials = {};
  try {
    const raw = await readFile(CREDENTIALS_PATH, 'utf8');
    existing = JSON.parse(raw) as V1Credentials;
  } catch {
    // File doesn't exist yet, start fresh
  }

  // Merge and remove empty values
  const merged: V1Credentials = {
    ...existing,
    ...config,
  };

  Object.keys(merged).forEach((k) => {
    if (!merged[k]) delete merged[k];
  });

  await writeFile(CREDENTIALS_PATH, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
}
