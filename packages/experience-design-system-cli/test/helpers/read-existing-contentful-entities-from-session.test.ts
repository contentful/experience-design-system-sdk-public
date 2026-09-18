import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readExistingContentfulEntitiesFromSession } from '../../src/helpers/read-existing-contentful-entities-from-session.js';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'read-existing-contentful-entities-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('readExistingContentfulEntitiesFromSession', () => {
  it('returns undefined when path is undefined', async () => {
    expect(await readExistingContentfulEntitiesFromSession(undefined)).toBeUndefined();
  });

  it('returns undefined when the file does not exist', async () => {
    await withTempDir(async (dir) => {
      const missing = join(dir, 'nope.json');
      expect(await readExistingContentfulEntitiesFromSession(missing)).toBeUndefined();
    });
  });

  it('returns undefined when the file is malformed JSON', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'bad.json');
      await writeFile(path, '{not-json}', 'utf8');
      expect(await readExistingContentfulEntitiesFromSession(path)).toBeUndefined();
    });
  });

  it('returns undefined when the JSON is valid but the shape is wrong', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'shape.json');
      await writeFile(path, JSON.stringify({ components: {}, tokens: [] }), 'utf8');
      expect(await readExistingContentfulEntitiesFromSession(path)).toBeUndefined();
    });
  });

  it('returns parsed content when JSON has the expected shape', async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, 'ok.json');
      const payload = {
        components: [{ sys: { id: 'c1' }, name: 'Button', description: 'CTA' }],
        tokens: [{ sys: { id: 't1' }, name: 'brand.primary', type: 'DTCG.Color' }],
      };
      await writeFile(path, JSON.stringify(payload), 'utf8');
      const entities = await readExistingContentfulEntitiesFromSession(path);
      expect(entities?.components).toHaveLength(1);
      expect(entities?.tokens).toHaveLength(1);
      expect(entities?.components[0]?.name).toBe('Button');
    });
  });
});
