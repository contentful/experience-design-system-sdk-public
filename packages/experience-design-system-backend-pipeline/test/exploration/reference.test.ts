import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadRendererReference } from '../../src/index.js';
import { loadStageContext } from '../../src/steps/exploration/src/helpers/load-stage-context.js';
describe('host-owned renderer reference', () => {
  it('reads text/path/URL references with explicit origin, digest and retrieval time', async () => {
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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('rejects failed, empty and cancelled reference capture', async () => {
    await expect(
      loadRendererReference({ kind: 'url' }, { fetchText: async () => new Response('', { status: 404 }) }),
    ).rejects.toThrow('fetch failed');
    await expect(loadRendererReference({ kind: 'text', text: '', origin: 'fixture' })).rejects.toThrow('empty');
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadRendererReference({ kind: 'text', text: 'Reference', origin: 'fixture' }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('renderer references without a default size limit', () => {
  it.each(['text', 'path', 'url'] as const)('retains a larger reference from %s without truncation', async (kind) => {
    const dir = mkdtempSync(join(tmpdir(), 'renderer-reference-size-'));
    try {
      const text = 'a'.repeat(256 * 1024);
      const path = join(dir, 'reference.md');
      writeFileSync(path, text);
      const input =
        kind === 'text'
          ? { kind, text, origin: 'fixture' }
          : kind === 'path'
            ? { kind, path }
            : { kind, url: 'https://example.com/reference' };
      const reference = await loadRendererReference(input, { fetchText: async () => new Response(text) });
      expect(reference.text).toBe(text);
      expect(reference.bytes).toBe(256 * 1024);
      expect(reference.coverage).toBe('complete-within-declared-bound');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

it('loads full reference, model and caller files above the former optional-context cap', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'renderer-stage-reference-'));
  try {
    const text = 'a'.repeat(256 * 1024);
    const path = join(dir, 'reference.md');
    writeFileSync(path, text);
    const request = {
      invoker: { invoke: async () => ({ stdout: '', stderr: '', exitCode: 0, timedOut: false }) },
      agent: 'codex' as const,
      scopes: [],
      rawComponentsInline: '[]',
      outDir: '',
      timeoutMs: 1000,
      sdkReferencePath: path,
    };
    expect((await loadStageContext(request)).rendererReference).toBe(text);
    expect(await loadStageContext({ ...request, existingModelPath: path, callSiteEvidencePath: path })).toEqual({
      rendererReference: text,
      existingModel: text,
      callSites: text,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
