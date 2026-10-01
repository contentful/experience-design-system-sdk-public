import { describe, it, expect } from 'vitest';
import {
  resolveCompositionSources,
  type CompositionCliOptions,
} from '../../../src/analyze/composition/resolve-mapping-cli.js';

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
});
