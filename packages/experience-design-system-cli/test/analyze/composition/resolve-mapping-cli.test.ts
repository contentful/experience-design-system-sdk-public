import { describe, it, expect } from 'vitest';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadUserMap,
  resolveCompositionSources,
  type CompositionCliOptions,
} from '../../../src/analyze/composition/resolve-mapping-cli.js';

describe('resolve-mapping-cli (T2/T6 flag routing)', () => {
  describe('loadUserMap', () => {
    it('loads and validates a hand-authored interchange file', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'cmap-'));
      const p = join(dir, 'map.json');
      await writeFile(p, JSON.stringify({ version: 1, groups: { A: ['B'] } }));
      const res = await loadUserMap(p);
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.map.groups.A).toEqual(['B']);
    });

    it('reports an error for invalid JSON', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'cmap-'));
      const p = join(dir, 'bad.json');
      await writeFile(p, '{ not json');
      const res = await loadUserMap(p);
      expect(res.ok).toBe(false);
    });

    it('reports an error for a schema-invalid map', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'cmap-'));
      const p = join(dir, 'wrong.json');
      await writeFile(p, JSON.stringify({ version: 2, groups: {} }));
      const res = await loadUserMap(p);
      expect(res.ok).toBe(false);
    });
  });

  describe('resolveCompositionSources', () => {
    it('flags useAgent when --composition-agent is set', () => {
      const opts: CompositionCliOptions = { compositionAgent: true };
      const res = resolveCompositionSources(opts);
      expect(res.useAgent).toBe(true);
    });

    it('flags forceAgent on --composition-refresh', () => {
      const res = resolveCompositionSources({ compositionRefresh: true });
      expect(res.forceAgent).toBe(true);
    });

    it('no composition flags → no agent', () => {
      const res = resolveCompositionSources({});
      expect(res.useAgent).toBeFalsy();
      expect(res.forceAgent).toBeFalsy();
    });
  });
});
