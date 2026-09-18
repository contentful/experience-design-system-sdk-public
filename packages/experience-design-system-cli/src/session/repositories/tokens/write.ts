import type { DatabaseSync } from 'node:sqlite';
import type { DTCGTokenEntry, DTCGTokenGroup } from '@contentful/experience-design-system-types';
import type { TokenToolCall } from '@contentful/experience-design-system-generation';
import type { RawTokenNamePaths, RawTokenNamePathSource } from './read.js';

export type RawPropTokenPathSource = 'agent' | 'review';

export function deleteRawTokensForSession(db: DatabaseSync, sessionId: string): void {
  db.prepare('DELETE FROM raw_token_groups WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM raw_tokens WHERE session_id = ?').run(sessionId);
}

export function createRawTokenGroups(db: DatabaseSync, sessionId: string, groups: DTCGTokenGroup[]): void {
  const insertGroup = db.prepare(`INSERT INTO raw_token_groups (session_id, path, description) VALUES (?, ?, ?)`);
  for (const group of groups) {
    insertGroup.run(sessionId, group.path, group.$description ?? null);
  }
}

export function createRawTokens(db: DatabaseSync, sessionId: string, tokens: DTCGTokenEntry[]): void {
  const insertToken = db.prepare(
    `INSERT INTO raw_tokens (session_id, path, type, value, description) VALUES (?, ?, ?, ?, ?)`,
  );
  for (const token of tokens) {
    insertToken.run(sessionId, token.path, token.$type, JSON.stringify(token.$value), token.$description ?? null);
  }
}

export function upsertRawToken(
  db: DatabaseSync,
  sessionId: string,
  call: Extract<TokenToolCall, { tool: 'set_token' }>,
): void {
  db.prepare(
    `INSERT INTO raw_tokens (session_id, path, type, value, description) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(session_id, path) DO UPDATE SET type = excluded.type, value = excluded.value, description = excluded.description`,
  ).run(sessionId, call.path, call.type, JSON.stringify(call.value), call.description ?? null);
}

export function upsertRawTokenGroup(
  db: DatabaseSync,
  sessionId: string,
  call: Extract<TokenToolCall, { tool: 'set_group' }>,
): void {
  db.prepare(
    `INSERT INTO raw_token_groups (session_id, path, description) VALUES (?, ?, ?)
     ON CONFLICT(session_id, path) DO UPDATE SET description = excluded.description`,
  ).run(sessionId, call.path, call.description ?? null);
}

export function updateRawTokenNamePaths(
  db: DatabaseSync,
  sessionId: string,
  tokenNamePaths: RawTokenNamePaths,
  source: RawTokenNamePathSource,
): void {
  const entries = Object.entries(tokenNamePaths);
  const deletePaths = db.prepare('DELETE FROM raw_token_name_paths WHERE session_id = ? AND source = ?');
  const insertPath = db.prepare(
    'INSERT OR IGNORE INTO raw_token_name_paths (session_id, raw_name, path, source) VALUES (?, ?, ?, ?)',
  );
  const deleteAutomaticByName = db.prepare(
    "DELETE FROM raw_token_name_paths WHERE session_id = ? AND raw_name = ? AND source = 'automatic'",
  );

  deletePaths.run(sessionId, source);
  for (const [rawName, path] of entries) {
    if (source === 'manual') deleteAutomaticByName.run(sessionId, rawName);
    insertPath.run(sessionId, rawName, path, source);
  }
}

export function updateRawPropTokenPaths(
  db: DatabaseSync,
  sessionId: string,
  componentId: string,
  propName: string,
  paths: string[],
  source: RawPropTokenPathSource,
): void {
  db.prepare(
    `DELETE FROM raw_prop_token_paths
     WHERE session_id = ? AND component_id = ? AND prop_name = ?`,
  ).run(sessionId, componentId, propName);
  const insertPath = db.prepare(
    `INSERT INTO raw_prop_token_paths (session_id, component_id, prop_name, source, position, path)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  paths.forEach((path, position) => {
    insertPath.run(sessionId, componentId, propName, source, position, path);
  });
}
