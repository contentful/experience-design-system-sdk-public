import { describe, it, expect } from 'vitest';

import { resolveGroupRoot } from '../../../src/import/tui/group-collapse.js';
import { computeAllClosures } from '../../../src/analyze/composite-closure.js';

describe('resolveGroupRoot (L9 — shared group-root resolution)', () => {
  // Card → Body → Heading closure; plus a standalone Solo.
  const graph = [
    { name: 'Card', slots: [{ name: 'body', allowedComponents: ['Body'] }] },
    { name: 'Body', slots: [{ name: 'inner', allowedComponents: ['Heading'] }] },
    { name: 'Heading', slots: [] },
    { name: 'Solo', slots: [] },
  ];
  const closures = computeAllClosures(graph);

  it('a cycle member resolves to itself (cycle set wins)', () => {
    const cycleSet = new Set(['P', 'C']);
    expect(resolveGroupRoot('P', closures, cycleSet)).toBe('P');
    expect(resolveGroupRoot('C', closures, cycleSet)).toBe('C');
  });

  it('a closure root resolves to itself', () => {
    expect(resolveGroupRoot('Card', closures, new Set())).toBe('Card');
  });

  it('a descendant resolves to its containing closure root', () => {
    expect(resolveGroupRoot('Body', closures, new Set())).toBe('Card');
    expect(resolveGroupRoot('Heading', closures, new Set())).toBe('Card');
  });

  it('an unknown key resolves to undefined', () => {
    expect(resolveGroupRoot('Nope', closures, new Set())).toBeUndefined();
  });
});
