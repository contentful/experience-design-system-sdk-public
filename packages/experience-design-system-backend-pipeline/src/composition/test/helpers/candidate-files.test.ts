import { describe, expect, it } from 'vitest';
import { selectCandidateFiles, capCandidatesToPromptBudget } from '../../helpers/candidate-files.js';

describe('selectCandidateFiles', () => {
  it('selects files whose path segment matches a name pattern', () => {
    const files = [
      { path: 'src/component-mapping.ts', content: 'export {}' },
      { path: 'src/utils.ts', content: 'export {}' },
    ];
    const result = selectCandidateFiles(files);
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('src/component-mapping.ts');
    expect(result[0]!.reason).toMatch(/^name:/);
  });

  it('selects files containing a content marker', () => {
    const files = [
      { path: 'src/helpers.ts', content: 'const x = allowedComponents;' },
      { path: 'src/other.ts', content: 'export const foo = 1;' },
    ];
    const result = selectCandidateFiles(files);
    expect(result).toHaveLength(1);
    expect(result[0]!.reason).toBe('content:allowedComponents');
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

  it('returns reason as name: for name match and content: for content match', () => {
    const byName = selectCandidateFiles([{ path: 'src/registry.ts', content: '' }]);
    expect(byName[0]!.reason).toMatch(/^name:/);

    const byContent = selectCandidateFiles([{ path: 'src/x.ts', content: 'createContext' }]);
    expect(byContent[0]!.reason).toMatch(/^content:/);
  });
});

describe('capCandidatesToPromptBudget', () => {
  it('keeps all files within budget', () => {
    const files = [{ path: 'a.ts', content: 'x'.repeat(100) }];
    const { kept, dropped } = capCandidatesToPromptBudget(files, 1000);
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it('drops files that would exceed the token budget', () => {
    const small = { path: 'small.ts', content: 'x'.repeat(100) };
    const big = { path: 'big.ts', content: 'x'.repeat(5000) };
    const { kept, dropped } = capCandidatesToPromptBudget([big, small], 1000);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.path).toBe('small.ts');
    expect(dropped[0]!.path).toBe('big.ts');
  });

  it('uses PROMPT_CANDIDATE_TOKEN_BUDGET as default', () => {
    const files = [{ path: 'a.ts', content: 'x' }];
    const { kept } = capCandidatesToPromptBudget(files);
    expect(kept).toHaveLength(1);
  });

  it('returns empty kept and all dropped when budget is 0', () => {
    const files = [{ path: 'a.ts', content: 'x' }];
    const { kept, dropped } = capCandidatesToPromptBudget(files, 0);
    expect(kept).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });

  it('processes smaller files first, filling budget greedily', () => {
    const files = [
      { path: 'c.ts', content: 'x'.repeat(400) },
      { path: 'a.ts', content: 'x'.repeat(100) },
      { path: 'b.ts', content: 'x'.repeat(200) },
    ];
    // budget 100 tokens = 400 chars. a(25)+b(50) = 75 tokens kept, c(100 tokens) > remaining 25 → dropped
    const { kept, dropped } = capCandidatesToPromptBudget(files, 100);
    expect(kept.map((f) => f.path).sort()).toEqual(['a.ts', 'b.ts']);
    expect(dropped[0]!.path).toBe('c.ts');
  });
});
