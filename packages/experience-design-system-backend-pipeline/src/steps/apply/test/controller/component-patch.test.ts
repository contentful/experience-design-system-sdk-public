import { describe, expect, it } from 'vitest';
import { applyComponentPatch } from '../../src/controller/mutate/mutate-cdf-component.js';
import { applyDotPath } from '../../src/controller/mutate/mutate-dot-path.js';
import { warnOnUnknownPatchComponents } from '../../src/controller/mutate/warn-on-unknown-patch-components.js';

describe('applyComponentPatch', () => {
  it('applies status + set to matched components, leaves others untouched', () => {
    const components = [
      { name: 'A', status: 'ok', meta: { x: 1 } },
      { name: 'B', status: 'ok', meta: { x: 1 } },
    ];
    const result = applyComponentPatch({
      components,
      operations: [{ component: 'A', status: 'rejected', set: { 'meta.x': 2 } }],
      applySet: (c, values) => ({ ...c, meta: { ...c.meta, x: values['meta.x'] as number } }),
    });
    expect(result[0]).toEqual({ name: 'A', status: 'rejected', meta: { x: 2 } });
    expect(result[1]).toEqual(components[1]);
  });
});

describe('applyDotPath', () => {
  it('sets a leaf value at a safe dotted path', () => {
    const obj: Record<string, unknown> = { a: { b: 1 } };
    const { warnings } = applyDotPath({ obj, path: 'a.b', value: 2 });
    expect(warnings).toEqual([]);
    expect(obj).toEqual({ a: { b: 2 } });
  });
  it('warns and skips on an invalid-character path', () => {
    const obj: Record<string, unknown> = {};
    const { warnings } = applyDotPath({ obj, path: 'a b', value: 1 });
    expect(warnings[0]).toMatch(/invalid characters/);
  });
  it('warns and skips on __proto__ paths', () => {
    const obj: Record<string, unknown> = {};
    const { warnings } = applyDotPath({ obj, path: '__proto__.polluted', value: 1 });
    expect(warnings[0]).toMatch(/forbidden key/);
  });
});

describe('warnOnUnknownPatchComponents', () => {
  it('emits one warning per unknown-component operation', () => {
    const warnings = warnOnUnknownPatchComponents({
      components: [{ name: 'A' }],
      operations: [{ component: 'A' }, { component: 'Missing' }],
    });
    expect(warnings).toEqual(["--patch targets unknown component 'Missing', skipped"]);
  });
});
