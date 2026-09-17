import { describe, it, expect } from 'vitest';
import { hashComponentShape } from '../../../../src/session/core/components/hash-component-shape.js';
import type { RawComponentDefinition } from '../../../../src/types.js';

function makeComponent(overrides: Partial<RawComponentDefinition> = {}): RawComponentDefinition {
  return {
    name: 'Button',
    source: './src/Button.tsx',
    framework: 'react',
    props: [],
    slots: [],
    ...overrides,
  };
}

describe('hashComponentShape', () => {
  it('produces the same hash for equal inputs', () => {
    expect(hashComponentShape(makeComponent())).toBe(hashComponentShape(makeComponent()));
  });

  it('is a 64-char sha256 hex string', () => {
    expect(hashComponentShape(makeComponent())).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when the source path changes', () => {
    expect(hashComponentShape(makeComponent({ source: 'a.tsx' }))).not.toBe(
      hashComponentShape(makeComponent({ source: 'b.tsx' })),
    );
  });

  it('sorts allowedComponents so slot order does not affect the hash', () => {
    const a = makeComponent({
      slots: [{ name: 'children', isDefault: true, allowedComponents: ['A', 'B'] }],
    });
    const b = makeComponent({
      slots: [{ name: 'children', isDefault: true, allowedComponents: ['B', 'A'] }],
    });
    expect(hashComponentShape(a)).toBe(hashComponentShape(b));
  });
});
