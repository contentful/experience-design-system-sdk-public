import { describe, it, expect } from 'vitest';
import { buildCompositionInputHash } from '../../../src/analyze/composition/composition-cache-key.js';

const files = [
  { path: '/repo/src/mapping.ts', content: 'a=1' },
  { path: '/repo/src/meta.ts', content: 'b=2' },
];

describe('buildCompositionInputHash', () => {
  it('is stable for identical inputs', () => {
    const k1 = buildCompositionInputHash({ files, agent: 'claude', kind: 'edges' });
    const k2 = buildCompositionInputHash({ files, agent: 'claude', kind: 'edges' });
    expect(k1).toBe(k2);
  });

  it('is order-independent across the candidate file set', () => {
    const k1 = buildCompositionInputHash({ files, agent: 'claude', kind: 'edges' });
    const k2 = buildCompositionInputHash({ files: [...files].reverse(), agent: 'claude', kind: 'edges' });
    expect(k1).toBe(k2);
  });

  it('changes when a candidate file CONTENT changes (not just mtime)', () => {
    const k1 = buildCompositionInputHash({ files, agent: 'claude', kind: 'edges' });
    const k2 = buildCompositionInputHash({
      files: [{ path: '/repo/src/mapping.ts', content: 'a=999' }, files[1]!],
      agent: 'claude',
      kind: 'edges',
    });
    expect(k1).not.toBe(k2);
  });

  it('changes when a file is added or removed', () => {
    const k1 = buildCompositionInputHash({ files, agent: 'claude', kind: 'edges' });
    const k2 = buildCompositionInputHash({ files: [files[0]!], agent: 'claude', kind: 'edges' });
    expect(k1).not.toBe(k2);
  });

  it('changes with the producing agent', () => {
    const k1 = buildCompositionInputHash({ files, agent: 'claude', kind: 'edges' });
    const k2 = buildCompositionInputHash({ files, agent: 'codex', kind: 'edges' });
    expect(k1).not.toBe(k2);
  });

  it('parser and edges kinds get distinct keys for the same files', () => {
    const kParser = buildCompositionInputHash({ files, agent: 'claude', kind: 'parser' });
    const kEdges = buildCompositionInputHash({ files, agent: 'claude', kind: 'edges' });
    expect(kParser).not.toBe(kEdges);
  });

  it('returns a hex sha256 string', () => {
    const k = buildCompositionInputHash({ files, agent: 'claude', kind: 'edges' });
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });
});
