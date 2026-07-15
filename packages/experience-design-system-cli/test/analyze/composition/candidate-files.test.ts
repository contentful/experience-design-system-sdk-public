import { describe, it, expect } from 'vitest';
import {
  CANDIDATE_NAME_PATTERNS,
  CANDIDATE_CONTENT_MARKERS,
  CANDIDATE_TOKEN_BUDGET,
  selectCandidateFiles,
  sliceDeclarationRegions,
  batchCandidates,
} from '../../../src/analyze/composition/candidate-files.js';

describe('candidate-files (T3 — deterministic pre-filter)', () => {
  describe('constants', () => {
    it('exposes name patterns for mapping and meta', () => {
      expect(CANDIDATE_NAME_PATTERNS.some((r) => r.test('foo.mapping.ts'))).toBe(true);
      expect(CANDIDATE_NAME_PATTERNS.some((r) => r.test('ComponentMeta.ts'))).toBe(true);
    });

    it('exposes the expected content markers', () => {
      expect(CANDIDATE_CONTENT_MARKERS).toEqual(
        expect.arrayContaining(['requiredParent', 'withParentType', 'allowedTagNames', 'createContext']),
      );
    });

    it('exposes a positive token budget', () => {
      expect(CANDIDATE_TOKEN_BUDGET).toBeGreaterThan(0);
    });
  });

  describe('selectCandidateFiles', () => {
    it('picks a *mapping*.ts file by name', () => {
      const res = selectCandidateFiles([{ path: 'src/foo.mapping.ts', content: 'export const x = 1;' }]);
      expect(res).toHaveLength(1);
      expect(res[0].path).toBe('src/foo.mapping.ts');
      expect(res[0].reason).toBe('name:mapping');
    });

    it('picks a *Meta*.ts file by name', () => {
      const res = selectCandidateFiles([{ path: 'src/ComponentMeta.ts', content: 'export const x = 1;' }]);
      expect(res).toHaveLength(1);
      expect(res[0].reason).toBe('name:meta');
    });

    it('picks a file containing requiredParent by content', () => {
      const res = selectCandidateFiles([{ path: 'src/card.ts', content: 'const c = { requiredParent: "Grid" };' }]);
      expect(res).toHaveLength(1);
      expect(res[0].reason).toBe('content:requiredParent');
    });

    it('picks files containing withParentType / allowedTagNames / createContext by content', () => {
      const res = selectCandidateFiles([
        { path: 'a.ts', content: 'withParentType("X")' },
        { path: 'b.ts', content: 'allowedTagNames: ["div"]' },
        { path: 'c.ts', content: 'const Ctx = createContext(null);' },
      ]);
      expect(res.map((r) => r.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
      expect(res.map((r) => r.reason)).toEqual([
        'content:withParentType',
        'content:allowedTagNames',
        'content:createContext',
      ]);
    });

    it('ignores an unrelated file', () => {
      const res = selectCandidateFiles([{ path: 'src/utils.ts', content: 'export const add = (a, b) => a + b;' }]);
      expect(res).toHaveLength(0);
    });

    it('dedups by path (a file counted once even if it matches multiple ways)', () => {
      const res = selectCandidateFiles([
        { path: 'src/foo.mapping.ts', content: 'const c = { requiredParent: "Grid" };' },
      ]);
      expect(res).toHaveLength(1);
    });

    it('reports the first matching reason when a file matches multiple', () => {
      // name match is checked before content match
      const res = selectCandidateFiles([{ path: 'src/foo.mapping.ts', content: 'requiredParent: "Grid"' }]);
      expect(res[0].reason).toBe('name:mapping');
    });

    it('does not emit duplicate entries for a repeated path', () => {
      const res = selectCandidateFiles([
        { path: 'src/foo.mapping.ts', content: 'a' },
        { path: 'src/foo.mapping.ts', content: 'a' },
      ]);
      expect(res).toHaveLength(1);
    });
  });

  describe('sliceDeclarationRegions', () => {
    it('returns empty when no marker is present', () => {
      expect(sliceDeclarationRegions('const x = 1;\nconst y = 2;')).toEqual([]);
    });

    it('returns a window of context lines around a single marker', () => {
      const lines = Array.from({ length: 11 }, (_, i) => `line${i}`);
      lines[5] = 'const c = { requiredParent: "Grid" };';
      const blocks = sliceDeclarationRegions(lines.join('\n'));
      expect(blocks).toHaveLength(1);
      // default window ±3 → lines 2..8
      expect(blocks[0]).toContain('requiredParent');
      expect(blocks[0]).toContain('line2');
      expect(blocks[0]).toContain('line8');
      expect(blocks[0]).not.toContain('line1');
      expect(blocks[0]).not.toContain('line9');
    });

    it('merges two nearby markers into a single block', () => {
      const lines = Array.from({ length: 12 }, (_, i) => `line${i}`);
      lines[4] = 'requiredParent: "A"';
      lines[6] = 'withParentType("B")';
      const blocks = sliceDeclarationRegions(lines.join('\n'));
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toContain('requiredParent');
      expect(blocks[0]).toContain('withParentType');
    });

    it('keeps distant markers as separate blocks', () => {
      const lines = Array.from({ length: 40 }, (_, i) => `line${i}`);
      lines[3] = 'requiredParent: "A"';
      lines[30] = 'allowedTagNames: ["div"]';
      const blocks = sliceDeclarationRegions(lines.join('\n'));
      expect(blocks).toHaveLength(2);
    });

    it('honors a custom marker list', () => {
      const content = 'const a = 1;\nspecialMarker here\nconst b = 2;';
      expect(sliceDeclarationRegions(content, ['specialMarker'])).toHaveLength(1);
      expect(sliceDeclarationRegions(content, ['requiredParent'])).toHaveLength(0);
    });
  });

  describe('batchCandidates', () => {
    const file = (path: string, len: number) => ({ path, content: 'x'.repeat(len) });

    it('groups several small files into a single batch', () => {
      const files = [file('a.ts', 100), file('b.ts', 100), file('c.ts', 100)];
      const batches = batchCandidates(files);
      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(3);
    });

    it('gives a single oversized file its own batch (never dropped)', () => {
      const huge = file('huge.ts', CANDIDATE_TOKEN_BUDGET * 4 + 1000);
      const files = [file('a.ts', 100), huge, file('b.ts', 100)];
      const batches = batchCandidates(files);
      const flat = batches.flat();
      expect(flat).toHaveLength(3);
      // the huge file is isolated in a batch of exactly one
      const hugeBatch = batches.find((b) => b.some((f) => f.path === 'huge.ts'));
      expect(hugeBatch).toHaveLength(1);
    });

    it('is deterministic and orders by path', () => {
      const files = [file('c.ts', 100), file('a.ts', 100), file('b.ts', 100)];
      const first = batchCandidates(files);
      const second = batchCandidates(files);
      expect(first).toEqual(second);
      expect(first.flat().map((f) => f.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    });

    it('drops nothing: sum of files across batches equals input count', () => {
      const budget = 500;
      const files = Array.from({ length: 25 }, (_, i) =>
        file(`f${String(i).padStart(2, '0')}.ts`, 100 + (i % 5) * 400),
      );
      const batches = batchCandidates(files, budget);
      expect(batches.flat()).toHaveLength(files.length);
    });

    it('splits into multiple batches when total exceeds the budget', () => {
      const budget = 100; // 100 tokens ≈ 400 chars
      const files = [file('a.ts', 400), file('b.ts', 400), file('c.ts', 400)];
      const batches = batchCandidates(files, budget);
      expect(batches.length).toBeGreaterThan(1);
      expect(batches.flat()).toHaveLength(3);
    });
  });
});
