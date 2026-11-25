import { mkdirSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { threadId } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { importProfileDirectory } from './import-profile.js';

export class SourceAccessProfile {
  private db?: DatabaseSync;
  private readonly update;
  private writes = 0;
  private phase = 'source';
  scope(phase: 'source' | 'envelope' | 'capture'): () => void {
    const previous = this.phase;
    this.phase = phase;
    let restored = false;
    return () => {
      if (restored) return;
      restored = true;
      if (this.phase === phase) this.phase = previous;
    };
  }
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `access.${process.pid}.${threadId}.${randomUUID()}.sqlite`);
    const db = new DatabaseSync(file);
    try {
      chmodSync(file, 0o600);
      db.exec(`PRAGMA cache_size=-2048; PRAGMA mmap_size=0; PRAGMA temp_store=FILE;
        CREATE TABLE accesses(phase TEXT,kind TEXT,id TEXT,detail TEXT,offset INTEGER,size INTEGER,
          requests INTEGER NOT NULL,reads INTEGER NOT NULL,bytes INTEGER NOT NULL,
          units INTEGER NOT NULL,cache_hits INTEGER NOT NULL,PRIMARY KEY(phase,kind,id)) WITHOUT ROWID;
        BEGIN;`);
      this.update = db.prepare(`INSERT INTO accesses VALUES(?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(phase,kind,id) DO UPDATE SET
          detail=COALESCE(excluded.detail,detail), offset=COALESCE(excluded.offset,offset),
          size=COALESCE(excluded.size,size),requests=requests+excluded.requests,
          reads=reads+excluded.reads,bytes=bytes+excluded.bytes,units=units+excluded.units,
          cache_hits=cache_hits+excluded.cache_hits`);
      this.db = db;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  private note(
    kind: 'record' | 'file',
    id: string,
    detail: string | null,
    offset: number | null,
    size: number | null,
    requests: number,
    reads: number,
    bytes: number,
    units: number,
    hits: number,
  ): void {
    if (!this.db) return;
    try {
      this.update.run(this.phase, kind, id, detail, offset, size, requests, reads, bytes, units, hits);
      if (++this.writes >= 10000) {
        this.db.exec('COMMIT; BEGIN');
        this.writes = 0;
      }
    } catch {
      this.close();
    }
  }
  recordVisit(id: string, offset: number, size: number): void {
    this.note('record', id, null, offset, size, 1, 0, 0, 0, 0);
  }
  recordCacheHit(id: string): void {
    this.note('record', id, null, null, null, 0, 0, 0, 0, 1);
  }
  recordRead(id: string, bytes: number): void {
    this.note('record', id, null, null, null, 0, 1, bytes, 0, 0);
  }
  fileBinding(id: string, path: string, hit: boolean): void {
    this.note('file', id, path, null, null, 1, 0, 0, 0, Number(hit));
  }
  fileScan(id: string, path: string, units: number): void {
    this.note('file', id, path, null, null, 0, 1, 0, units, 0);
  }
  close(): void {
    const db = this.db;
    this.db = undefined;
    if (!db) return;
    try {
      db.exec('COMMIT');
    } catch {}
    try {
      db.close();
    } catch {}
  }
}
export function createSourceAccessProfile(): SourceAccessProfile | undefined {
  const directory = importProfileDirectory();
  if (!directory || process.env.EDS_IMPORT_PROFILE_ACCESS !== '1') return undefined;
  try {
    return new SourceAccessProfile(directory);
  } catch {
    return undefined;
  }
}
