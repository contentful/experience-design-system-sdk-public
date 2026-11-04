import { describe, expect, it } from 'vitest';
import { selectCandidateFiles } from '../../src/helpers/candidates/candidate-files.js';

describe('selectCandidateFiles', () => {
  it('selects files whose path segment matches a name pattern', () => {
    const files = [
      { path: 'src/component-mapping.ts', content: 'export {}' },
      { path: 'src/utils.ts', content: 'export {}' },
    ];
    const result = selectCandidateFiles(files);
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('src/component-mapping.ts');
    expect(result[0]!.matchReason).toMatch(/^name:/);
  });

  it('selects files containing a content marker', () => {
    const files = [
      { path: 'src/helpers.ts', content: 'const x = allowedComponents;' },
      { path: 'src/other.ts', content: 'export const foo = 1;' },
    ];
    const result = selectCandidateFiles(files);
    expect(result).toHaveLength(1);
    expect(result[0]!.matchReason).toBe('content:allowedComponents');
  });

  it('does not select files with no matching name or content', () => {
    const files = [{ path: 'src/button.tsx', content: 'export function Button() {}' }];
    expect(selectCandidateFiles(files)).toHaveLength(0);
  });

  it('deduplicates files with the same path', () => {
    const files = [
      { path: 'src/schema.ts', content: 'registry' },
      { path: 'src/schema.ts', content: 'registry 2' },
    ];
    expect(selectCandidateFiles(files)).toHaveLength(1);
  });

  it('matches all documented name patterns', () => {
    const patterns = ['mapping', 'meta', 'registry', 'schema', 'composition'];
    for (const pattern of patterns) {
      const files = [{ path: `src/${pattern}.ts`, content: '' }];
      const result = selectCandidateFiles(files);
      expect(result, `expected ${pattern} to match`).toHaveLength(1);
    }
  });

  it('returns matchReason as name: for name match and content: for content match', () => {
    const byName = selectCandidateFiles([{ path: 'src/registry.ts', content: '' }]);
    expect(byName[0]!.matchReason).toMatch(/^name:/);

    const byContent = selectCandidateFiles([{ path: 'src/x.ts', content: 'createContext' }]);
    expect(byContent[0]!.matchReason).toMatch(/^content:/);
  });
});
