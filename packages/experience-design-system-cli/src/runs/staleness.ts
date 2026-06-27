import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256Hex } from './fingerprint.js';
import type { RunRecord } from './store.js';

export type Staleness = {
  stale: boolean;
  /** Component names whose source file's mtime no longer matches the
   *  recorded fingerprint. */
  staleComponents: string[];
  /** True when the raw tokens file's mtime OR content hash drifted (or the
   *  file went missing). */
  staleTokens: boolean;
  /** True when components.json on disk differs from the hash recorded at
   *  save time, OR the file is missing. */
  savedComponentsEdited: boolean;
  /** True when tokens.json on disk differs from the hash recorded at save
   *  time, OR the file is missing while a hash was recorded. */
  savedTokensEdited: boolean;
  /** Absolute paths of source files that were fingerprinted but have since
   *  disappeared. Empty when nothing is missing. */
  missingSourceFiles: string[];
};

const UNKNOWN: Staleness = {
  stale: false,
  staleComponents: [],
  staleTokens: false,
  savedComponentsEdited: false,
  savedTokensEdited: false,
  missingSourceFiles: [],
};

/**
 * Re-stat the source files and re-hash the saved artifacts captured by a
 * run record's fingerprints, and report what (if anything) drifted.
 *
 * Returns `stale: false` when the run is missing a source fingerprint
 * entirely (v2 records pre-dating runs.json v3 — treat as UNKNOWN, not
 * stale, so existing runs keep replaying).
 */
export async function checkRunStaleness(run: RunRecord): Promise<Staleness> {
  if (!run.sourceFingerprint) return { ...UNKNOWN };

  const result: Staleness = {
    stale: false,
    staleComponents: [],
    staleTokens: false,
    savedComponentsEdited: false,
    savedTokensEdited: false,
    missingSourceFiles: [],
  };

  // ── Per-file source check ────────────────────────────────────────────
  for (const [absPath, entry] of Object.entries(run.sourceFingerprint.files)) {
    try {
      const st = await stat(absPath);
      if (st.mtime.toISOString() !== entry.mtime) {
        result.staleComponents.push(entry.componentName ?? absPath);
        result.stale = true;
      }
    } catch {
      result.missingSourceFiles.push(absPath);
      result.stale = true;
    }
  }

  // ── Raw tokens (single file: re-stat AND re-hash) ────────────────────
  if (run.sourceFingerprint.rawTokensPath) {
    const absPath = run.sourceFingerprint.rawTokensPath;
    try {
      const [st, buf] = await Promise.all([stat(absPath), readFile(absPath)]);
      const mtime = st.mtime.toISOString();
      const hash = sha256Hex(buf);
      const mtimeChanged =
        run.sourceFingerprint.rawTokensMtime !== null && mtime !== run.sourceFingerprint.rawTokensMtime;
      const hashChanged =
        run.sourceFingerprint.rawTokensContentHash !== null && hash !== run.sourceFingerprint.rawTokensContentHash;
      if (mtimeChanged || hashChanged) {
        result.staleTokens = true;
        result.stale = true;
      }
    } catch {
      result.staleTokens = true;
      result.stale = true;
    }
  }

  // ── Saved-file check (read & hash components.json / tokens.json) ─────
  if (run.savedFingerprint) {
    if (run.savedFingerprint.componentsJsonHash !== null) {
      const compPath = join(run.savePath, 'components.json');
      try {
        const buf = await readFile(compPath);
        if (sha256Hex(buf) !== run.savedFingerprint.componentsJsonHash) {
          result.savedComponentsEdited = true;
          result.stale = true;
        }
      } catch {
        result.savedComponentsEdited = true;
        result.stale = true;
      }
    }
    if (run.savedFingerprint.tokensJsonHash !== null) {
      const tokensPath = run.tokensPath ?? join(run.savePath, 'tokens.json');
      try {
        const buf = await readFile(tokensPath);
        if (sha256Hex(buf) !== run.savedFingerprint.tokensJsonHash) {
          result.savedTokensEdited = true;
          result.stale = true;
        }
      } catch {
        result.savedTokensEdited = true;
        result.stale = true;
      }
    }
  }

  return result;
}

/**
 * Render a short human-readable summary of a Staleness result, e.g.
 * `src: 3, tokens, saved`. Returns the empty string when not stale.
 */
export function shortStalenessSummary(s: Staleness): string {
  if (!s.stale) return '';
  const parts: string[] = [];
  const srcCount = s.staleComponents.length + s.missingSourceFiles.length;
  if (srcCount > 0) parts.push(`src: ${srcCount}`);
  if (s.staleTokens) parts.push('tokens');
  if (s.savedComponentsEdited || s.savedTokensEdited) parts.push('saved');
  return parts.join(', ');
}

/**
 * Render a multi-line detail block for staleness output (used by `runs <id>`
 * detail view and replay refusals). Caps long lists at 5 entries.
 */
export function formatStalenessDetail(s: Staleness): string[] {
  if (!s.stale) return ['Status: FRESH'];
  const lines: string[] = ['Status: STALE'];
  const cap = 5;
  if (s.staleComponents.length > 0) {
    const head = s.staleComponents.slice(0, cap).join(', ');
    const more = s.staleComponents.length > cap ? ` and ${s.staleComponents.length - cap} more` : '';
    lines.push(`  Source changed: ${head}${more}`);
  }
  if (s.missingSourceFiles.length > 0) {
    const head = s.missingSourceFiles.slice(0, cap).join(', ');
    const more = s.missingSourceFiles.length > cap ? ` and ${s.missingSourceFiles.length - cap} more` : '';
    lines.push(`  Source missing: ${head}${more}`);
  }
  if (s.staleTokens) lines.push('  Raw tokens drifted');
  if (s.savedComponentsEdited) lines.push('  Saved components.json edited');
  if (s.savedTokensEdited) lines.push('  Saved tokens.json edited');
  return lines;
}
