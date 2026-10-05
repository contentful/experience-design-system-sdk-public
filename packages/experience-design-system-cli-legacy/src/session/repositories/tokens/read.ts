import type { DatabaseSync } from 'node:sqlite';
import type { DTCGTokenEntry, DTCGTokenGroup } from '@contentful/experience-design-system-types';
import { buildDtcgGroups, type GroupRow, type TokenRow } from '../../core/tokens/build-dtcg-groups.js';
import { buildDtcgTokens } from '../../core/tokens/build-dtcg-tokens.js';

export type RawTokenNamePaths = Record<string, string>;
export type RawTokenNamePathSource = 'automatic' | 'manual';

export interface RawTokenNamePath {
  rawName: string;
  path: string;
  source: RawTokenNamePathSource;
}

export function getDtcgTokensForSession(
  db: DatabaseSync,
  sessionId: string,
): { groups: DTCGTokenGroup[]; tokens: DTCGTokenEntry[] } {
  const groupRows: GroupRow[] = db
    .prepare('SELECT path, description FROM raw_token_groups WHERE session_id = ? ORDER BY path')
    .all(sessionId)
    .map((row) => ({
      path: String(row.path),
      description: row.description === null ? null : String(row.description),
    }));

  const tokenRows: TokenRow[] = db
    .prepare('SELECT path, type, value, description FROM raw_tokens WHERE session_id = ? ORDER BY path')
    .all(sessionId)
    .map((row) => ({
      path: String(row.path),
      type: String(row.type),
      value: String(row.value),
      description: row.description === null ? null : String(row.description),
    }));

  return {
    groups: buildDtcgGroups(groupRows, tokenRows),
    tokens: buildDtcgTokens(tokenRows),
  };
}

export function getRawTokenNamePaths(db: DatabaseSync, sessionId: string): RawTokenNamePaths {
  const rows = db
    .prepare('SELECT raw_name, path FROM raw_token_name_paths WHERE session_id = ? ORDER BY raw_name')
    .all(sessionId);
  return Object.fromEntries(rows.map((row) => [String(row.raw_name), String(row.path)]));
}

export function getRawTokenNamePathRows(db: DatabaseSync, sessionId: string): RawTokenNamePath[] {
  return db
    .prepare('SELECT raw_name, path, source FROM raw_token_name_paths WHERE session_id = ? ORDER BY raw_name')
    .all(sessionId)
    .map((row) => ({
      rawName: String(row.raw_name),
      path: String(row.path),
      source: String(row.source) as RawTokenNamePathSource,
    }));
}
