import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hashContent, hashFile, hashPromptForSkill } from '../../src/session/cache-keys.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'cache-keys-'));
  tempDirs.push(d);
  return d;
}

describe('cache-keys', () => {
  describe('hashContent', () => {
    it('returns a 64-char hex string', () => {
      const h = hashContent('hello world');
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is stable for the same input', () => {
      expect(hashContent('abc')).toBe(hashContent('abc'));
    });

    it('differs for different inputs', () => {
      expect(hashContent('a')).not.toBe(hashContent('b'));
    });
  });

  describe('hashFile', () => {
    it('hashes file content matching hashContent of same string', async () => {
      const d = await tmp();
      const p = join(d, 'a.txt');
      await writeFile(p, 'hello world', 'utf8');
      const fileHash = await hashFile(p);
      expect(fileHash).toBe(hashContent('hello world'));
    });

    it('returns the same hash for two files with identical content', async () => {
      const d = await tmp();
      const a = join(d, 'a.txt');
      const b = join(d, 'b.txt');
      await writeFile(a, 'same', 'utf8');
      await writeFile(b, 'same', 'utf8');
      expect(await hashFile(a)).toBe(await hashFile(b));
    });
  });

  describe('hashPromptForSkill', () => {
    it('hashes the bundled select skill file when no override is provided', async () => {
      const h = await hashPromptForSkill('select');
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it('hashes the bundled components skill file', async () => {
      const h = await hashPromptForSkill('components');
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    });

    it('returns a different hash for an override path', async () => {
      const d = await tmp();
      const p = join(d, 'custom.md');
      await writeFile(p, 'custom prompt content totally different', 'utf8');
      const bundledHash = await hashPromptForSkill('select');
      const overrideHash = await hashPromptForSkill('select', p);
      expect(overrideHash).not.toBe(bundledHash);
      expect(overrideHash).toBe(hashContent('custom prompt content totally different'));
    });
  });
});
