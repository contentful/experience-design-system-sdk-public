import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

export const RUNS_FILE_VERSION = 1 as const;
export const RUNS_FILE_CAP = 200;

export type RunRecord = {
  id: string;
  createdAt: string;
  projectPath: string;
  savePath: string;
  componentCount: number;
  tokenCount: number;
  agent: string;
  pushedTo: { spaceId: string; environmentId: string; host: string } | null;
  extractSessionId: string;
  generateSessionId: string | null;
  notes?: string;
};

export type RunsFile = {
  version: typeof RUNS_FILE_VERSION;
  runs: RunRecord[];
};

const RUNS_DIR = join(homedir(), '.config', 'experiences');
const RUNS_PATH = join(RUNS_DIR, 'runs.json');

export function runsFilePath(): string {
  return RUNS_PATH;
}

// Crockford-base32 ULID (26 chars: 10 timestamp + 16 random).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeBase32(bytes: Uint8Array, length: number): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += CROCKFORD[(value >> bits) & 0x1f];
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 0x1f];
  return out.slice(0, length);
}

export function generateUlid(now: number = Date.now()): string {
  // 48-bit timestamp -> 10 chars
  const tsBytes = new Uint8Array(6);
  let n = now;
  for (let i = 5; i >= 0; i--) {
    tsBytes[i] = n & 0xff;
    n = Math.floor(n / 256);
  }
  const ts = encodeBase32(tsBytes, 10);
  const rand = encodeBase32(randomBytes(10), 16);
  return (ts + rand).toUpperCase();
}

async function readFileMaybe(): Promise<RunsFile | null> {
  try {
    const raw = await readFile(RUNS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as RunsFile;
    if (parsed.version !== RUNS_FILE_VERSION) {
      throw new Error(
        `runs.json version mismatch: file is v${parsed.version}, this CLI expects v${RUNS_FILE_VERSION}. Migration not yet supported; back up and remove the file to start fresh.`,
      );
    }
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw err;
  }
}

async function writeAtomic(file: RunsFile): Promise<void> {
  await mkdir(RUNS_DIR, { recursive: true });
  const body = JSON.stringify(file, null, 2) + '\n';
  const tmp = `${RUNS_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, RUNS_PATH);
}

export type AppendInput = Omit<RunRecord, 'id' | 'createdAt'> & Partial<Pick<RunRecord, 'id' | 'createdAt'>>;

export async function appendRun(input: AppendInput): Promise<RunRecord> {
  const existing = await readFileMaybe();
  const record: RunRecord = {
    ...input,
    id: input.id ?? generateUlid(),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  const runs = existing ? [record, ...existing.runs] : [record];
  if (runs.length > RUNS_FILE_CAP) {
    const dropped = runs.length - RUNS_FILE_CAP;
    runs.length = RUNS_FILE_CAP;
    // eslint-disable-next-line no-console
    console.warn(`runs.json reached cap of ${RUNS_FILE_CAP}; dropped ${dropped} oldest entr${dropped === 1 ? 'y' : 'ies'}.`);
  }
  await writeAtomic({ version: RUNS_FILE_VERSION, runs });
  return record;
}

export type ListOptions = {
  limit?: number;
  projectPath?: string;
  before?: string;
  after?: string;
};

export async function listRuns(opts: ListOptions = {}): Promise<RunRecord[]> {
  const file = await readFileMaybe();
  if (!file) return [];
  let runs = file.runs;
  if (opts.projectPath) runs = runs.filter((r) => r.projectPath === opts.projectPath);
  if (opts.before) runs = runs.filter((r) => r.createdAt < opts.before!);
  if (opts.after) runs = runs.filter((r) => r.createdAt > opts.after!);
  if (typeof opts.limit === 'number') runs = runs.slice(0, opts.limit);
  return runs;
}

export async function getRun(id: string): Promise<RunRecord> {
  const file = await readFileMaybe();
  const found = file?.runs.find((r) => r.id === id);
  if (!found) throw new Error(`Run ${id} not found in ${RUNS_PATH}`);
  return found;
}

export async function updateRun(id: string, patch: Partial<Omit<RunRecord, 'id'>>): Promise<RunRecord> {
  const file = (await readFileMaybe()) ?? { version: RUNS_FILE_VERSION, runs: [] };
  const idx = file.runs.findIndex((r) => r.id === id);
  if (idx < 0) throw new Error(`Run ${id} not found in ${RUNS_PATH}`);
  const updated: RunRecord = { ...file.runs[idx]!, ...patch, id };
  file.runs[idx] = updated;
  await writeAtomic(file);
  return updated;
}

export async function findRunBySavePath(savePath: string): Promise<RunRecord | null> {
  const file = await readFileMaybe();
  return file?.runs.find((r) => r.savePath === savePath) ?? null;
}
