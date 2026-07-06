import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

export type SourceFileEntry = { mtime: string; componentName?: string };

export type SourceFingerprint = {
  files: Record<string, SourceFileEntry>;
  rawTokensPath: string | null;
  rawTokensMtime: string | null;
  rawTokensContentHash: string | null;
};

export type SavedFingerprint = {
  componentsJsonHash: string | null;
  tokensJsonHash: string | null;
};

/**
 * Minimal duck-typed sqlite interface; we don't depend on better-sqlite3
 * directly from this module (the wizard already opens the DB and passes it
 * in). `name` may be null in the DB; we filter those rows out.
 */
export interface RawComponentsDb {
  prepare(sql: string): { all(sessionId: string): Array<Record<string, unknown>> };
}

function rowField(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return typeof v === 'string' ? v : null;
}

export function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Build a per-file fingerprint of every source file that contributed to a
 * run. Stats each unique source_path once (first-seen component name wins),
 * and (optionally) hashes the raw tokens file too.
 *
 * Missing files do NOT throw — they're simply omitted. The read-side
 * staleness check re-stats from disk and surfaces missing files there so we
 * can report which one disappeared.
 */
export async function buildSourceFingerprint(opts: {
  db: RawComponentsDb;
  extractSessionId: string;
  rawTokensPath?: string | null;
}): Promise<SourceFingerprint> {
  const rows = opts.db
    .prepare('SELECT name, source_path FROM raw_components WHERE session_id = ?')
    .all(opts.extractSessionId);

  const files: Record<string, SourceFileEntry> = {};
  const seen = new Set<string>();
  for (const row of rows) {
    const sourcePath = rowField(row, 'source_path');
    const name = rowField(row, 'name');
    if (!sourcePath) continue;
    const abs = resolve(sourcePath);
    if (seen.has(abs)) continue;
    seen.add(abs);
    try {
      const st = await stat(abs);
      const entry: SourceFileEntry = { mtime: st.mtime.toISOString() };
      if (name) entry.componentName = name;
      files[abs] = entry;
    } catch {
      // Source file missing at fingerprint time — skip silently. Staleness
      // can only fire on files we recorded; a file removed before save
      // simply isn't tracked. Operators usually re-extract in that case.
    }
  }

  let rawTokensPath: string | null = null;
  let rawTokensMtime: string | null = null;
  let rawTokensContentHash: string | null = null;
  if (opts.rawTokensPath) {
    const abs = resolve(opts.rawTokensPath);
    rawTokensPath = abs;
    try {
      const [st, buf] = await Promise.all([stat(abs), readFile(abs)]);
      rawTokensMtime = st.mtime.toISOString();
      rawTokensContentHash = sha256Hex(buf);
    } catch {
      // Missing raw tokens — record the path but leave mtime/hash null so
      // the staleness check can detect it as missing on read.
    }
  }

  return { files, rawTokensPath, rawTokensMtime, rawTokensContentHash };
}

/**
 * Hash the saved JSON contents the wizard just wrote. Caller passes the raw
 * bytes (or strings) so we hash exactly what landed on disk.
 */
export function buildSavedFingerprint(input: {
  componentsJson: string | Buffer | null;
  tokensJson: string | Buffer | null;
}): SavedFingerprint {
  return {
    componentsJsonHash: input.componentsJson != null ? sha256Hex(input.componentsJson) : null,
    tokensJsonHash: input.tokensJson != null ? sha256Hex(input.tokensJson) : null,
  };
}
