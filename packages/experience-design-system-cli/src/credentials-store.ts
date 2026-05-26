import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type ExoCredentials = {
  spaceId: string;
  environmentId: string;
  cmaToken: string;
};

const CREDENTIALS_DIR = join(homedir(), '.config', 'exo');
const CREDENTIALS_PATH = join(CREDENTIALS_DIR, 'credentials.json');

export async function readExoCredentials(): Promise<ExoCredentials> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<ExoCredentials>;
    return {
      spaceId: process.env['CONTENTFUL_SPACE_ID'] ?? parsed.spaceId ?? '',
      environmentId: process.env['CONTENTFUL_ENVIRONMENT_ID'] ?? parsed.environmentId ?? '',
      cmaToken: process.env['CONTENTFUL_MANAGEMENT_TOKEN'] ?? parsed.cmaToken ?? '',
    };
  } catch {
    return {
      spaceId: process.env['CONTENTFUL_SPACE_ID'] ?? '',
      environmentId: process.env['CONTENTFUL_ENVIRONMENT_ID'] ?? '',
      cmaToken: process.env['CONTENTFUL_MANAGEMENT_TOKEN'] ?? '',
    };
  }
}

export async function writeExoCredentials(creds: ExoCredentials): Promise<void> {
  await mkdir(CREDENTIALS_DIR, { recursive: true });
  await writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2) + '\n', { mode: 0o600 });
}

export function exoCredentialsPath(): string {
  return CREDENTIALS_PATH;
}
