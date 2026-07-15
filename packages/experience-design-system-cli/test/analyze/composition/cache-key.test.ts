import { describe, it, expect } from 'vitest';
import { buildMappingCacheKey, RESOLVER_VERSION } from '../../../src/analyze/composition/cache-key.js';

const files = [
  { path: '/repo/src/mapping.ts', content: 'a=1' },
  { path: '/repo/src/meta.ts', content: 'b=2' },
];

describe('buildMappingCacheKey (T5)', () => {
  it('is stable for identical inputs', () => {
    const k1 = buildMappingCacheKey({ files, producer: { kind: 'agent', agent: 'claude', model: 'opus' } });
    const k2 = buildMappingCacheKey({ files, producer: { kind: 'agent', agent: 'claude', model: 'opus' } });
    expect(k1).toBe(k2);
  });

  it('is order-independent across the candidate file set', () => {
    const k1 = buildMappingCacheKey({ files, producer: { kind: 'agent', agent: 'claude' } });
    const k2 = buildMappingCacheKey({ files: [...files].reverse(), producer: { kind: 'agent', agent: 'claude' } });
    expect(k1).toBe(k2);
  });

  it('changes when a candidate file CONTENT changes (not just mtime)', () => {
    const k1 = buildMappingCacheKey({ files, producer: { kind: 'agent', agent: 'claude' } });
    const k2 = buildMappingCacheKey({
      files: [{ path: '/repo/src/mapping.ts', content: 'a=999' }, files[1]],
      producer: { kind: 'agent', agent: 'claude' },
    });
    expect(k1).not.toBe(k2);
  });

  it('changes when a file is added or removed', () => {
    const k1 = buildMappingCacheKey({ files, producer: { kind: 'agent', agent: 'claude' } });
    const k2 = buildMappingCacheKey({ files: [files[0]], producer: { kind: 'agent', agent: 'claude' } });
    expect(k1).not.toBe(k2);
  });

  it('changes when the resolver version changes', () => {
    const k1 = buildMappingCacheKey({ files, producer: { kind: 'agent', agent: 'claude' }, resolverVersion: 1 });
    const k2 = buildMappingCacheKey({ files, producer: { kind: 'agent', agent: 'claude' }, resolverVersion: 2 });
    expect(k1).not.toBe(k2);
  });

  it('agent vs adapter producer yields different keys', () => {
    const kAgent = buildMappingCacheKey({ files, producer: { kind: 'agent', agent: 'claude', model: 'opus' } });
    const kAdapter = buildMappingCacheKey({ files, producer: { kind: 'adapter', adapter: 'required-parent' } });
    expect(kAgent).not.toBe(kAdapter);
  });

  it('a different model yields a different agent key', () => {
    const k1 = buildMappingCacheKey({ files, producer: { kind: 'agent', agent: 'claude', model: 'opus' } });
    const k2 = buildMappingCacheKey({ files, producer: { kind: 'agent', agent: 'claude', model: 'sonnet' } });
    expect(k1).not.toBe(k2);
  });

  it('defaults resolverVersion to the exported constant', () => {
    const k1 = buildMappingCacheKey({ files, producer: { kind: 'agent', agent: 'claude' } });
    const k2 = buildMappingCacheKey({
      files,
      producer: { kind: 'agent', agent: 'claude' },
      resolverVersion: RESOLVER_VERSION,
    });
    expect(k1).toBe(k2);
  });

  it('returns a hex sha256 string', () => {
    const k = buildMappingCacheKey({ files, producer: { kind: 'agent', agent: 'claude' } });
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});
