import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { extractReactComponents } from '@contentful/experience-design-system-extraction';

const FIXTURES = resolve(import.meta.dirname, 'fixtures');

describe('untyped destructured parameter fallback', () => {
  it('extracts binding element names as props from untyped destructured params', async () => {
    const { components } = await extractReactComponents([resolve(FIXTURES, 'untyped-destructured.tsx')]);

    expect(components).toHaveLength(1);
    expect(components[0].name).toBe('ChecklistWrapper');

    const propNames = components[0].props.map((p) => p.name);
    expect(propNames).toContain('description');
    expect(propNames).toContain('checklistItem1');
    expect(propNames).toContain('checklistItem2');
    expect(propNames).toContain('checklistItem3');
    expect(components[0].props.length).toBe(4);
  });

  it('props from untyped destructured params have string type by default', async () => {
    const { components } = await extractReactComponents([resolve(FIXTURES, 'untyped-destructured.tsx')]);

    for (const prop of components[0].props) {
      expect(['string', 'any']).toContain(prop.type);
    }
  });

  it('does not crash on non-destructured untyped params', async () => {
    const { components } = await extractReactComponents([resolve(FIXTURES, 'untyped-no-destructure.tsx')]);

    expect(components).toHaveLength(1);
    expect(components[0].name).toBe('Passthrough');
  });
});
