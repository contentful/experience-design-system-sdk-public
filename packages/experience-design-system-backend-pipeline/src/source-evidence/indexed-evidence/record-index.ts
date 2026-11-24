import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { EvidenceRecordLocation } from './types.js';

const RECORD_INDEX_FILE = 'record-index.sqlite';

export class EvidenceRecordIndex {
  private readonly db: DatabaseSync;
  private readonly lookup: StatementSync;
  private readonly insert?: StatementSync;

  constructor(directory: string, mode: 'create' | 'read') {
    const path = join(directory, RECORD_INDEX_FILE);
    if (mode === 'create') closeSync(openSync(path, 'wx', 0o600));
    this.db = new DatabaseSync(path, { readOnly: mode === 'read' });
    try {
      this.db.exec('PRAGMA cache_size = -2048; PRAGMA mmap_size = 0;');
      if (mode === 'create') {
        this.db.exec(`
          PRAGMA user_version = 1;
          CREATE TABLE records (
            id TEXT PRIMARY KEY,
            offset INTEGER NOT NULL,
            bytes INTEGER NOT NULL,
            kind TEXT NOT NULL,
            count INTEGER NOT NULL
          ) WITHOUT ROWID;
          BEGIN;
        `);
        this.insert = this.db.prepare('INSERT INTO records (id, offset, bytes, kind, count) VALUES (?, ?, ?, ?, ?)');
      } else if (this.db.prepare('PRAGMA user_version').get()?.user_version !== 1) {
        throw new Error('Unsupported evidence record index');
      }
      this.lookup = this.db.prepare('SELECT offset, bytes, kind, count FROM records WHERE id = ?');
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  get(id: string): EvidenceRecordLocation | undefined {
    const row = this.lookup.get(id);
    if (!row) return undefined;
    if (
      ![row.offset, row.bytes, row.count].every(
        (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0,
      ) ||
      !['object', 'array', 'text'].includes(String(row.kind))
    )
      throw new Error('Invalid evidence record location');
    return row as unknown as EvidenceRecordLocation;
  }

  add(id: string, location: EvidenceRecordLocation): void {
    if (!this.insert) throw new Error('Evidence record index is read-only');
    this.insert.run(id, location.offset, location.bytes, location.kind, location.count);
  }

  publish(): void {
    if (!this.insert) throw new Error('Evidence record index is read-only');
    this.db.exec('COMMIT');
  }

  close(): void {
    this.db.close();
  }
}
