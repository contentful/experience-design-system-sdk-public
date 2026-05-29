import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { extractReactComponents } from '../../../src/analyze/extract/react.js';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

describe('default export resolution', () => {
  it('extracts const arrow function with typed interface', async () => {
    const { components } = await extractReactComponents([resolve(FIXTURES, 'default-export-arrow.tsx')]);

    expect(components).toHaveLength(1);
    expect(components[0].name).toBe('Logo');
    expect(components[0].props.length).toBeGreaterThanOrEqual(1);

    const propNames = components[0].props.map((p) => p.name);
    expect(propNames).toContain('item');
    expect(propNames).toContain('verticalTop');
  });

  it('still extracts function declaration default exports (regression)', async () => {
    const { components } = await extractReactComponents([resolve(FIXTURES, 'default-export-named-fn.tsx')]);

    expect(components).toHaveLength(1);
    expect(components[0].name).toBe('Button');

    const propNames = components[0].props.map((p) => p.name);
    expect(propNames).toContain('label');
    expect(propNames).toContain('variant');
    expect(propNames).toContain('disabled');
  });

  it('extracts untyped default export arrow function with fallback props', async () => {
    const { components } = await extractReactComponents([resolve(FIXTURES, 'default-export-no-type.tsx')]);

    expect(components).toHaveLength(1);
    expect(components[0].name).toBe('Untyped');

    const propNames = components[0].props.map((p) => p.name);
    expect(propNames).toContain('title');
    expect(propNames).toContain('count');
  });

  it('does not duplicate when both named and default export exist', async () => {
    const { components } = await extractReactComponents([resolve(FIXTURES, 'default-export-also-named.tsx')]);

    expect(components).toHaveLength(1);
    expect(components[0].name).toBe('Card');

    const propNames = components[0].props.map((p) => p.name);
    expect(propNames).toContain('title');
    expect(propNames).toContain('imageUrl');
  });
});
