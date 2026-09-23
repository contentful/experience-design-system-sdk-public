import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import {
  loadUserMap,
  resolveCompositionSources,
  type CompositionCliOptions,
} from '../../../src/analyze/composition/resolve-mapping-cli.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resolve-mapping-cli (T2/T6 flag routing)', () => {
  describe('resolveCompositionSources', () => {
    it('enables edge emission by default', () => {
      const opts: CompositionCliOptions = {};
      expect(resolveCompositionSources(opts).forceAgent).toBe(false);
    });

    it('flags forceAgent on --composition-refresh', () => {
      const res = resolveCompositionSources({ compositionRefresh: true });
      expect(res.forceAgent).toBe(true);
    });

    it('keeps edge emission enabled when no refresh is requested', () => {
      const res = resolveCompositionSources({});
      expect(res.forceAgent).toBeFalsy();
    });
  });

  describe('loadUserMap', () => {
    it('loads a valid hand-authored composition map', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'composition-map-'));
      tempDirs.push(dir);
      const path = join(dir, 'map.json');
      await writeFile(path, JSON.stringify({ version: 1, groups: { Page: ['Hero'] } }));

      await expect(loadUserMap(path)).resolves.toEqual({
        ok: true,
        map: { version: 1, groups: { Page: ['Hero'] } },
      });
    });

    it('rejects missing, malformed, and invalid map files', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'composition-map-'));
      tempDirs.push(dir);
      const malformed = join(dir, 'malformed.json');
      const invalid = join(dir, 'invalid.json');
      await writeFile(malformed, '{');
      await writeFile(invalid, JSON.stringify({ version: 2, groups: {} }));

      await expect(loadUserMap(join(dir, 'missing.json'))).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('file not found'),
      });
      await expect(loadUserMap(malformed)).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('not valid JSON'),
      });
      await expect(loadUserMap(invalid)).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining('unsupported interchange version'),
      });
    });
  });
});
