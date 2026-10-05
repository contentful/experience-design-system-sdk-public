import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { extractReactComponents } from '@contentful/experience-design-system-extraction';

const FIXTURES = resolve(import.meta.dirname, 'fixtures/array-map-render');

describe('structural evidence: array-map render (Signal D)', () => {
  it('detects <Child/> mapped from a plain data-array prop and synthesises a default slot on the parent', async () => {
    const { components } = await extractReactComponents([
      resolve(FIXTURES, 'accordion.tsx'),
      resolve(FIXTURES, 'accordion-item.tsx'),
    ]);

    const accordion = components.find((c) => c.name === 'Accordion');
    expect(accordion).toBeDefined();
    expect(accordion!.slots).toHaveLength(1);
    expect(accordion!.slots[0]).toMatchObject({ name: 'children', isDefault: true });
    expect(accordion!.slots[0].structuralAllowedComponents).toContain('AccordionItem');
    expect(accordion!.slots[0].allowedComponents).toBeUndefined();
  });

  it('does NOT fire when the mapped prop is ReactNode[] (typed-slot pass owns this shape)', async () => {
    const { components } = await extractReactComponents([
      resolve(FIXTURES, 'negative-reactnode-array.tsx'),
      resolve(FIXTURES, 'row.tsx'),
    ]);

    const negList = components.find((c) => c.name === 'NegList');
    expect(negList).toBeDefined();
    // The typed-slot pass converts `entries: ReactNode[]` into an `entries`
    // slot on its own; Signal D must not double-count or add a synthesised
    // `children` slot on top of that.
    const synthesisedChildren = negList!.slots.find(
      (s) => s.name === 'children' && s.structuralAllowedComponents?.includes('Row'),
    );
    expect(synthesisedChildren).toBeUndefined();
  });

  it('does NOT fire when the mapped child is also rendered outside the map', async () => {
    const { components } = await extractReactComponents([
      resolve(FIXTURES, 'negative-child-rendered-twice.tsx'),
      resolve(FIXTURES, 'cell.tsx'),
    ]);

    const negTable = components.find((c) => c.name === 'NegTable');
    expect(negTable).toBeDefined();
    // Cell is used as a private implementation detail (header + rows), not
    // an authorable slot child. No synthesised slot should exist.
    expect(negTable!.slots).toHaveLength(0);
  });

  it('does NOT fire when the callback returns an intrinsic element', async () => {
    const { components } = await extractReactComponents([resolve(FIXTURES, 'negative-intrinsic.tsx')]);

    const negTags = components.find((c) => c.name === 'NegTags');
    expect(negTags).toBeDefined();
    expect(negTags!.slots).toHaveLength(0);
  });
});
