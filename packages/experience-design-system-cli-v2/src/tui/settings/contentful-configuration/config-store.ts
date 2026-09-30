import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Adapter to read/write v1's shared credentials store.
 * V2's configuration screen uses this to manage Contentful credentials
 * that are shared with v1's import and setup flows.
 */

export type DsiConfiguration = {
  space_id: string;
  env_id: string;
  cma_token: string;
  host: string;
};

export const EMPTY_CONFIGURATION: DsiConfiguration = {
  space_id: '',
  env_id: '',
  cma_token: '',
  host: '',
};

const CREDENTIALS_DIR = join(homedir(), '.config', 'experiences');
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, 'credentials.json');

export async function readDsiConfiguration(): Promise<DsiConfiguration> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      space_id: (parsed.spaceId as string) || '',
      env_id: (parsed.environmentId as string) || '',
      cma_token: (parsed.cmaToken as string) || '',
      host: (parsed.host as string) || '',
    };
  } catch {
    return { ...EMPTY_CONFIGURATION };
  }
}

export async function writeDsiConfiguration(config: DsiConfiguration): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });

  // Read any existing v1 config to preserve non-credential fields
  let v1Config: Record<string, any> = {};
  try {
    const raw = await readFile(CREDENTIALS_PATH, 'utf8');
    v1Config = JSON.parse(raw) as Record<string, any>;
  } catch {
    // File doesn't exist yet, start fresh
  }

  // Write credentials in v1's camelCase format, preserve other fields
  const merged: Record<string, any> = {
    ...v1Config,
  };

  if (config.space_id) merged.spaceId = config.space_id;
  if (config.env_id) merged.environmentId = config.env_id;
  if (config.cma_token) merged.cmaToken = config.cma_token;
  if (config.host) merged.host = config.host;

  // Remove empty values
  Object.keys(merged).forEach((k) => {
    if (!merged[k]) delete merged[k];
  });

  await writeFile(
    CREDENTIALS_PATH,
    `${JSON.stringify(merged, null, 2)}\n`,
    { mode: 0o600 },
  );
}
