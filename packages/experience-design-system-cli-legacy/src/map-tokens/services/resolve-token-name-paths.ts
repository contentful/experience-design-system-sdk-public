import { readFile } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import { replaceRawTokenNamePaths, loadRawTokenNamePathRows } from '../../session/db.js';
import { resolveTokenDefaults } from '../resolve-defaults.js';

export async function resolveTokenNamePaths(
  db: DatabaseSync,
  sessionId: string,
  tokenMapPath: string | undefined,
): Promise<{ tokenLeaves: Array<{ path: string; type: string }>; diagnostics: string[] }> {
  const tokenLeaves = db
    .prepare('SELECT path, type FROM raw_tokens WHERE session_id = ? ORDER BY path')
    .all(sessionId) as Array<{ path: string; type: string }>;
  const knownTokenPaths = new Set(tokenLeaves.map((t) => t.path));

  const tokenMapDiagnostics: string[] = [];
  if (tokenMapPath) {
    const fileMappings = JSON.parse(await readFile(tokenMapPath, 'utf8')) as Record<string, string>;
    const validMappings: Record<string, string> = {};
    for (const [rawName, path] of Object.entries(fileMappings)) {
      if (knownTokenPaths.has(path)) {
        validMappings[rawName] = path;
      } else {
        tokenMapDiagnostics.push(`Token map '${rawName}' -> '${path}': path not found in session tokens — skipped.`);
      }
    }
    // Replace-all-manual-then-insert, before the automatic pass, so the file
    // is the source of truth for manual mappings on every run.
    replaceRawTokenNamePaths(db, sessionId, validMappings, 'manual');
  }

  // Resolve generated design-token props by their source reference when one
  // was extracted. The rendered default value stays out of this prepass.
  const rawDefaults = db
    .prepare(
      `SELECT rp.default_value AS default_reference, rp.cdf_token_kind
       FROM raw_props rp
       JOIN raw_components rc ON rc.session_id = rp.session_id AND rc.component_id = rp.component_id
       WHERE rp.session_id = ? AND rc.status = 'generated'
         AND rp.cdf_type = 'token' AND rp.cdf_category = 'design'
         AND rp.default_value IS NOT NULL`,
    )
    .all(sessionId) as Array<{
    default_reference: string;
    cdf_token_kind: string | null;
  }>;
  const defaultResolution = resolveTokenDefaults(
    rawDefaults.map((row) => ({
      rawDefault: row.default_reference,
      tokenKind: row.cdf_token_kind,
    })),
    tokenLeaves,
  );
  const manualMappings = new Map(
    loadRawTokenNamePathRows(db, sessionId)
      .filter((row) => row.source === 'manual')
      .map((row) => [row.rawName, row.path]),
  );
  const automaticMappings: Record<string, string> = {};
  const diagnostics = [
    ...tokenMapDiagnostics,
    ...defaultResolution.diagnostics.map((diagnostic) => diagnostic.message),
  ];
  for (const [rawName, path] of Object.entries(defaultResolution.mappings)) {
    const manualPath = manualMappings.get(rawName);
    if (manualPath === undefined) {
      automaticMappings[rawName] = path;
    } else if (manualPath !== path) {
      diagnostics.push(
        `Token default '${rawName}' automatically resolves to '${path}', but manual mapping '${manualPath}' is retained.`,
      );
    }
  }
  replaceRawTokenNamePaths(db, sessionId, automaticMappings, 'automatic');

  return { tokenLeaves, diagnostics };
}
