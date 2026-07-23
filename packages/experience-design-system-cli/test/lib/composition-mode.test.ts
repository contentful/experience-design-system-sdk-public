import { describe, it, expect, afterEach } from 'vitest';
import { resolveCompositionMode } from '../../src/lib/composition-mode.js';

const ENV = 'EXPERIENCES_COMPOSITION_MODE';

describe('resolveCompositionMode (flag > env > config > default)', () => {
  afterEach(() => {
    delete process.env[ENV];
  });

  it('defaults to atomic when nothing is set', () => {
    expect(resolveCompositionMode({}, undefined)).toBe('atomic');
  });

  it('flag --composite wins', () => {
    expect(resolveCompositionMode({ composite: true }, 'atomic')).toBe('composite');
  });

  it('flag --atomic wins', () => {
    expect(resolveCompositionMode({ atomic: true }, 'composite')).toBe('atomic');
  });

  it('env overrides config and default', () => {
    process.env[ENV] = 'composite';
    expect(resolveCompositionMode({}, 'atomic')).toBe('composite');
    process.env[ENV] = 'atomic';
    expect(resolveCompositionMode({}, 'composite')).toBe('atomic');
  });

  it('flag beats env', () => {
    process.env[ENV] = 'composite';
    expect(resolveCompositionMode({ atomic: true }, undefined)).toBe('atomic');
  });

  it('persisted config beats default', () => {
    expect(resolveCompositionMode({}, 'composite')).toBe('composite');
  });

  it('ignores an empty or unknown env value', () => {
    process.env[ENV] = '';
    expect(resolveCompositionMode({}, undefined)).toBe('atomic');
    process.env[ENV] = 'weird';
    expect(resolveCompositionMode({}, 'composite')).toBe('composite');
  });

  describe('implicit composite from a composition source', () => {
    it('the composition agent implies composite', () => {
      expect(resolveCompositionMode({ compositionAgent: true }, undefined)).toBe('composite');
    });

    it('a user map implies composite', () => {
      expect(resolveCompositionMode({ compositionMap: './m.json' }, undefined)).toBe('composite');
    });

    it('--generate-map implies composite', () => {
      expect(resolveCompositionMode({ generateMap: './out.json' }, undefined)).toBe('composite');
    });

    it('composition-refresh implies composite', () => {
      expect(resolveCompositionMode({ compositionRefresh: true }, undefined)).toBe('composite');
    });

    it('an implied source beats env and config', () => {
      process.env[ENV] = 'atomic';
      expect(resolveCompositionMode({ compositionMap: './m.json' }, 'atomic')).toBe('composite');
    });

    it('explicit --atomic still wins over an implied source (contradictory input, user said no)', () => {
      expect(resolveCompositionMode({ atomic: true, compositionMap: './m.json' }, undefined)).toBe('atomic');
    });

    it('explicit --composite is unaffected', () => {
      expect(resolveCompositionMode({ composite: true, compositionAgent: true }, undefined)).toBe('composite');
    });

    it('no source and nothing else → still atomic default', () => {
      expect(resolveCompositionMode({}, undefined)).toBe('atomic');
    });
  });
});
