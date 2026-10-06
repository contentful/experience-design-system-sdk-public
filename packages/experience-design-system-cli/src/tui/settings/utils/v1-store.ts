import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Shared v1 credentials store (backwards compatible with cli-v1)
const V1_STORE_PATH = join(homedir(), '.config', 'experiences', 'credentials.json');

export async function readV1Store(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(V1_STORE_PATH, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function writeV1Store(data: Record<string, unknown>): Promise<void> {
  await mkdir(join(homedir(), '.config', 'experiences'), { recursive: true });
  await writeFile(V1_STORE_PATH, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}
