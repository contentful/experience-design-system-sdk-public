import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { EvidenceRecordLocation } from './types.js';

export interface CapturedScalarTextRecord {
  recordId: string;
  owner: string;
  key: string;
  bytes: number;
}
export const RECORD_INDEX_FILE = 'record-index.sqlite';

export class EvidenceRecordIndex {
  private readonly db: DatabaseSync;
  private readonly lookup: StatementSync;
  private readonly insert?: StatementSync;
  private scalarLookup?: StatementSync;
  private scalarInsert?: StatementSync;
  private scalarLookupChecked = false;

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

  addCapturedScalar(entry: CapturedScalarTextRecord): void {
    if (!this.insert) throw new Error('Evidence record index is read-only');
    if (!this.scalarInsert) {
      this.db.exec(
        'CREATE TABLE captured_scalar_text (id TEXT PRIMARY KEY, owner TEXT, field TEXT, bytes INTEGER) WITHOUT ROWID',
      );
      this.scalarInsert = this.db.prepare('INSERT OR IGNORE INTO captured_scalar_text VALUES (?,?,?,?)');
      this.scalarLookup = this.db.prepare('SELECT owner,field,bytes FROM captured_scalar_text WHERE id=?');
    }
    this.scalarInsert.run(entry.recordId, entry.owner, entry.key, entry.bytes);
  }
  capturedScalar(id: string): CapturedScalarTextRecord | undefined {
    if (!this.scalarLookup) {
      if (this.scalarLookupChecked) return undefined;
      this.scalarLookupChecked = true;
      if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='captured_scalar_text'").get())
        return undefined;
      this.scalarLookup = this.db.prepare('SELECT owner,field,bytes FROM captured_scalar_text WHERE id=?');
    }
    const row = this.scalarLookup.get(id);
    if (!row) return undefined;
    if (
      !/^[a-f0-9]{64}$/.test(id) ||
      !/^[a-f0-9]{64}$/.test(String(row.owner)) ||
      typeof row.field !== 'string' ||
      !Number.isSafeInteger(row.bytes) ||
      Number(row.bytes) < 1 ||
      Number(row.bytes) > 64 * 1024
    )
      throw new Error('Invalid captured scalar text descriptor');
    return { recordId: id, owner: String(row.owner), key: row.field, bytes: Number(row.bytes) };
  }

  publish(): void {
    if (!this.insert) throw new Error('Evidence record index is read-only');
    this.db.exec('COMMIT');
  }

  close(): void {
    this.db.close();
  }
}
