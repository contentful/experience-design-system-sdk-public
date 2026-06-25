import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  openPipelineDb,
  storeExtractCache,
  lookupExtractCache,
  getCliCacheVersion,
} from '../../src/session/db.js';
import type { RawComponentDefinition } from '../../src/types.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

async function tmpDbPath(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'extract-cache-'));
  tempDirs.push(d);
  return join(d, 'pipeline.db');
}

function sampleComponent(name = 'Button'): RawComponentDefinition {
  return {
    name,
    source: '/abs/path/Button.tsx',
    framework: 'react',
    props: [{ name: 'label', type: 'string', required: true }],
    slots: [],
  };
}

describe('extract_cache', () => {
  it('creates the extract_cache table with the expected columns', async () => {
    const db = openPipelineDb(await tmpDbPath());
    const cols = db.prepare('PRAGMA table_info(extract_cache)').all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    expect(colNames.has('file_path')).toBe(true);
    expect(colNames.has('file_hash')).toBe(true);
    expect(colNames.has('cli_version')).toBe(true);
    expect(colNames.has('created_at')).toBe(true);
    expect(colNames.has('updated_at')).toBe(true);
    expect(colNames.has('components_json')).toBe(true);
    db.close();
  });

  it('round-trips storeExtractCache + lookupExtractCache', async () => {
    const db = openPipelineDb(await tmpDbPath());
    const comp = sampleComponent();
    const cliVersion = await getCliCacheVersion();
    storeExtractCache(db, '/abs/path/Button.tsx', 'abc123', cliVersion, [comp]);

    const hit = lookupExtractCache(db, 'abc123', cliVersion);
    expect(hit).not.toBeNull();
    expect(hit?.filePath).toBe('/abs/path/Button.tsx');
    expect(hit?.components).toHaveLength(1);
    expect(hit?.components[0]?.name).toBe('Button');
    expect(hit?.components[0]?.props[0]?.name).toBe('label');
    db.close();
  });

  it('does not collide between different cli_version values', async () => {
    const db = openPipelineDb(await tmpDbPath());
    storeExtractCache(db, '/p/A.tsx', 'hash1', 'v-old', [sampleComponent('A')]);
    storeExtractCache(db, '/p/A.tsx', 'hash1', 'v-new', [sampleComponent('B')]);

    const oldHit = lookupExtractCache(db, 'hash1', 'v-old');
    const newHit = lookupExtractCache(db, 'hash1', 'v-new');
    expect(oldHit?.components[0]?.name).toBe('A');
    expect(newHit?.components[0]?.name).toBe('B');
    db.close();
  });

  it('returns null on miss', async () => {
    const db = openPipelineDb(await tmpDbPath());
    expect(lookupExtractCache(db, 'nonexistent', 'v1')).toBeNull();
    db.close();
  });

  it('deserializes components_json back into structured components', async () => {
    const db = openPipelineDb(await tmpDbPath());
    const comp: RawComponentDefinition = {
      name: 'Card',
      source: 'src/Card.tsx',
      framework: 'react',
      props: [
        { name: 'title', type: 'string', required: true },
        { name: 'subtitle', type: 'string', required: false, defaultValue: '' },
      ],
      slots: [{ name: 'children', isDefault: true }],
      sourcePath: '/abs/Card.tsx',
    };
    storeExtractCache(db, '/abs/Card.tsx', 'hashX', 'v1', [comp]);
    const hit = lookupExtractCache(db, 'hashX', 'v1');
    expect(hit?.components[0]).toMatchObject({
      name: 'Card',
      framework: 'react',
      props: [
        { name: 'title', type: 'string', required: true },
        { name: 'subtitle', type: 'string', required: false, defaultValue: '' },
      ],
      slots: [{ name: 'children', isDefault: true }],
    });
    db.close();
  });

  it('getCliCacheVersion returns a stable non-empty string', async () => {
    const a = await getCliCacheVersion();
    const b = await getCliCacheVersion();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
