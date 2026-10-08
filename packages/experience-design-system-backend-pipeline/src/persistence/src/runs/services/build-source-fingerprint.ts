import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sha256Hex } from '../core/sha256-hex.js';
import type { RawComponentsDb, SourceFileEntry, SourceFingerprint } from '../types/source-fingerprint.js';

function rowField(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return typeof v === 'string' ? v : null;
}

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
      // missing file at fingerprint time — skip; staleness check surfaces this on read
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
      // missing file — record path, leave mtime/hash null
    }
  }

  return { files, rawTokensPath, rawTokensMtime, rawTokensContentHash };
}
