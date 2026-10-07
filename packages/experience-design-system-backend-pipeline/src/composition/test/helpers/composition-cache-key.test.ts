import { describe, expect, it } from 'vitest';
import { buildCompositionInputHash } from '../../helpers/composition-cache-key.js';

describe('buildCompositionInputHash', () => {
  it('returns a 64-character hex string', () => {
    const hash = buildCompositionInputHash({ files: [], agent: 'claude' });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same hash for identical inputs', () => {
    const input = { files: [{ path: 'a.ts', content: 'export {}' }], agent: 'claude' };
    expect(buildCompositionInputHash(input)).toBe(buildCompositionInputHash(input));
  });

  it('returns a different hash when the agent changes', () => {
    const files = [{ path: 'a.ts', content: 'x' }];
    expect(buildCompositionInputHash({ files, agent: 'claude' })).not.toBe(
      buildCompositionInputHash({ files, agent: 'codex' }),
    );
  });

  it('returns a different hash when file content changes', () => {
    const agent = 'claude';
    const a = buildCompositionInputHash({ files: [{ path: 'a.ts', content: 'v1' }], agent });
    const b = buildCompositionInputHash({ files: [{ path: 'a.ts', content: 'v2' }], agent });
    expect(a).not.toBe(b);
  });

  it('returns a different hash when file path changes', () => {
    const agent = 'claude';
    const a = buildCompositionInputHash({ files: [{ path: 'a.ts', content: 'x' }], agent });
    const b = buildCompositionInputHash({ files: [{ path: 'b.ts', content: 'x' }], agent });
    expect(a).not.toBe(b);
  });

  it('is order-independent — same hash regardless of file array order', () => {
    const agent = 'claude';
    const files1 = [{ path: 'a.ts', content: 'a' }, { path: 'b.ts', content: 'b' }];
    const files2 = [{ path: 'b.ts', content: 'b' }, { path: 'a.ts', content: 'a' }];
    expect(buildCompositionInputHash({ files: files1, agent })).toBe(
      buildCompositionInputHash({ files: files2, agent }),
    );
  });

  it('returns empty-files hash for empty file list', () => {
    const h1 = buildCompositionInputHash({ files: [], agent: 'claude' });
    const h2 = buildCompositionInputHash({ files: [], agent: 'claude' });
    expect(h1).toBe(h2);
  });
});
