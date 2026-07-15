import { describe, it, expect } from 'vitest';
import { BUILTIN_ADAPTERS, getBuiltinAdapter } from '../../../../src/analyze/composition/adapters/index.js';

describe('builtin adapter registry (T6)', () => {
  it('contains exactly one adapter named required-parent', () => {
    expect(BUILTIN_ADAPTERS).toHaveLength(1);
    expect(BUILTIN_ADAPTERS[0].name).toBe('required-parent');
    expect(BUILTIN_ADAPTERS[0].candidateGlobs.length).toBeGreaterThan(0);
    expect(typeof BUILTIN_ADAPTERS[0].adapter).toBe('function');
  });

  it('getBuiltinAdapter returns the required-parent adapter', () => {
    const found = getBuiltinAdapter('required-parent');
    expect(found).toBeDefined();
    expect(found?.name).toBe('required-parent');
  });

  it('getBuiltinAdapter returns undefined for an unknown name', () => {
    expect(getBuiltinAdapter('nope')).toBeUndefined();
  });
});
