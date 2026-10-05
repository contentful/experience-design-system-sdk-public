import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { extractReactComponents } from '@contentful/experience-design-system-extraction';

describe('structural composition evidence (blue-accordion case)', () => {
  it('surfaces the parent->child relationship via structuralAllowedComponents when the slot has no declared ReactElement<XProps> contract', async () => {
    const shell = join(process.cwd(), 'test/analyze/extract/fixtures/accordion-shell.tsx');
    const item = join(process.cwd(), 'test/analyze/extract/fixtures/accordion-item.tsx');
    const result = await extractReactComponents([shell, item]);

    const accordion = result.components.find((c) => c.name === 'Accordion');
    expect(accordion).toBeDefined();

    const childrenSlot = accordion!.slots.find((s) => s.name === 'children');
    expect(childrenSlot).toBeDefined();
    // No declared generic on the slot's own prop type — the typed-slot
    // extractor alone finds nothing here, which is exactly the bug this
    // structural pass fixes.
    expect(childrenSlot!.allowedComponents ?? []).toEqual([]);
    expect(childrenSlot!.structuralAllowedComponents).toEqual(['AccordionItem']);
  });
});
