import { describe, it, expect } from 'vitest';
import { preClassifyComponent } from '@contentful/experience-design-system-extraction';
import { isNonAuthorableComponent } from '@contentful/experience-design-system-extraction';
import type { RawComponentDefinition } from '../../src/types.js';

// Exercises the same composition that command.ts will use:
//   pre-classify → filter → emit
function runPipeline(components: RawComponentDefinition[]) {
  const classified = components.map(preClassifyComponent);
  const kept: RawComponentDefinition[] = [];
  const skippedWarnings: string[] = [];
  for (const c of classified) {
    const verdict = isNonAuthorableComponent(c);
    if (verdict.skip) {
      skippedWarnings.push(`Skipped non-authorable component: ${c.name} (${verdict.reason})`);
      continue;
    }
    kept.push(c);
  }
  return { kept, skippedWarnings };
}

describe('analyze pipeline composition: pre-classify → non-authorable filter', () => {
  it('drops AbmProvider and keeps Accordion', () => {
    const input: RawComponentDefinition[] = [
      {
        name: 'AbmProvider',
        source: '/abm/AbmContext.tsx',
        framework: 'react',
        usesCreateContext: true,
        props: [{ name: 'value', type: 'AbmAccount | null', required: true }],
        slots: [{ name: 'children', isDefault: true }],
      },
      {
        name: 'Accordion',
        source: '/components/Accordion.tsx',
        framework: 'react',
        props: [{ name: 'title', type: 'string', required: true }],
        slots: [{ name: 'children', isDefault: true }],
      },
    ];
    const { kept, skippedWarnings } = runPipeline(input);
    expect(kept.map((c) => c.name)).toEqual(['Accordion']);
    expect(skippedWarnings).toHaveLength(1);
    expect(skippedWarnings[0]).toMatch(/AbmProvider/);
  });
});
