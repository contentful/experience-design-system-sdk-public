import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadRendererReference } from '../../src/index.js';
describe('host-owned bounded renderer reference', () => {
  it('reads bounded text/path/URL references with explicit origin, digest and retrieval time', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'renderer-reference-'));
    try {
      const path = join(dir, 'reference.md');
      writeFileSync(path, 'Renderer contract.');
      const text = await loadRendererReference({ kind: 'text', text: 'Renderer contract.', origin: 'fixture' });
      const file = await loadRendererReference({ kind: 'path', path });
      const url = await loadRendererReference(
        { kind: 'url', url: 'https://example.com/reference' },
        { fetchText: async () => new Response('Renderer contract.') },
      );
      expect(file.digest).toBe(text.digest);
      expect(url.digest).toBe(text.digest);
      expect(file.origin).toBe(path);
      expect(url.origin).toBe('https://example.com/reference');
      expect(text).toMatchObject({ bytes: 18, coverage: 'complete-within-declared-bound' });
      expect(Date.parse(text.retrievedAt)).not.toBeNaN();
      await expect(loadRendererReference({ kind: 'path', path }, { maxBytes: 4 })).rejects.toThrow('byte bound');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('rejects failed, oversized, empty and cancelled reference capture', async () => {
    await expect(
      loadRendererReference({ kind: 'url' }, { fetchText: async () => new Response('', { status: 404 }) }),
    ).rejects.toThrow('fetch failed');
    await expect(
      loadRendererReference({ kind: 'url' }, { fetchText: async () => new Response('too large'), maxBytes: 3 }),
    ).rejects.toThrow('byte bound');
    await expect(loadRendererReference({ kind: 'text', text: '', origin: 'fixture' })).rejects.toThrow('empty');
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadRendererReference({ kind: 'text', text: 'Reference', origin: 'fixture' }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
