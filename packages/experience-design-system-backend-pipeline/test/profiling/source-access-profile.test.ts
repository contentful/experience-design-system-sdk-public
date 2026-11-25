import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { createSourceAccessProfile } from '../../src/profiling/source-access-profile.js';
const roots: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
it('counts repeated record and source-file accesses on disk without retaining their bodies', () => {
  const root = mkdtempSync(join(tmpdir(), 'source-access-'));
  roots.push(root);
  vi.stubEnv('EDS_IMPORT_PROFILE_DIR', root);
  vi.stubEnv('EDS_IMPORT_PROFILE_ACCESS', '1');
  const access = createSourceAccessProfile()!;
  access.recordVisit('a', 12, 64);
  access.recordVisit('a', 12, 64);
  access.recordRead('a', 64);
  access.recordRead('a', 64);
  const release = access.scope('envelope');
  access.recordVisit('a', 12, 64);
  release();
  access.fileBinding('f', 'src/example.ts', false);
  access.fileBinding('f', 'src/example.ts', true);
  access.fileScan('f', 'src/example.ts', 30);
  access.close();
  const db = new DatabaseSync(join(root, readdirSync(root).find((name) => name.endsWith('.sqlite'))!), {
    readOnly: true,
  });
  try {
    expect(
      db.prepare("SELECT requests,reads,bytes FROM accesses WHERE kind='record' AND phase='source' AND id='a'").get(),
    ).toMatchObject({ requests: 2, reads: 2, bytes: 128 });
    expect(
      db.prepare("SELECT requests,reads,units,cache_hits FROM accesses WHERE kind='file' AND id='f'").get(),
    ).toMatchObject({ requests: 2, reads: 1, units: 30, cache_hits: 1 });
  } finally {
    db.close();
  }
});
it('restores nested access phases once even when a release repeats', () => {
  const root = mkdtempSync(join(tmpdir(), 'source-access-'));
  roots.push(root);
  vi.stubEnv('EDS_IMPORT_PROFILE_DIR', root);
  vi.stubEnv('EDS_IMPORT_PROFILE_ACCESS', '1');
  const access = createSourceAccessProfile()!;
  const outer = access.scope('envelope');
  const inner = access.scope('capture');
  inner();
  inner();
  access.recordVisit('inner', 1, 1);
  outer();
  outer();
  access.recordVisit('outer', 1, 1);
  access.close();
  const db = new DatabaseSync(join(root, readdirSync(root).find((name) => name.endsWith('.sqlite'))!), {
    readOnly: true,
  });
  try {
    expect(db.prepare("SELECT id,phase FROM accesses WHERE kind='record' ORDER BY id").all()).toEqual([
      { id: 'inner', phase: 'envelope' },
      { id: 'outer', phase: 'source' },
    ]);
  } finally {
    db.close();
  }
});
it('does no access logging when disabled and contains unwritable diagnostic storage', () => {
  const root = mkdtempSync(join(tmpdir(), 'source-access-'));
  roots.push(root);
  vi.stubEnv('EDS_IMPORT_PROFILE_DIR', root);
  vi.stubEnv('EDS_IMPORT_PROFILE_ACCESS', '');
  expect(createSourceAccessProfile()).toBeUndefined();
  expect(readdirSync(root)).toEqual([]);
  writeFileSync(join(root, 'file'), 'not a directory');
  vi.stubEnv('EDS_IMPORT_PROFILE_ACCESS', '1');
  vi.stubEnv('EDS_IMPORT_PROFILE_DIR', join(root, 'file'));
  expect(createSourceAccessProfile()).toBeUndefined();
});
