import { describe, it, expect } from 'vitest';
import { preClassifyComponent } from '@contentful/experience-design-system-extraction';
import { isNonAuthorableComponent } from '@contentful/experience-design-system-extraction';
import type { RawComponentDefinition } from '../../src/types.js';

function runPipeline(components: RawComponentDefinition[]) {
  const classified = components.map(preClassifyComponent);
  const kept: RawComponentDefinition[] = [];
  const reviewWarnings: string[] = [];
  for (const c of classified) {
    const verdict = isNonAuthorableComponent(c);
    if (verdict.skip) {
      reviewWarnings.push(`${c.name}: requires operator review (${verdict.reason})`);
      kept.push({
        ...c,
        needsReview: true,
        reviewReasons: [...(c.reviewReasons ?? []), `non-authorable:${verdict.reason}`],
      });
    } else {
      kept.push(c);
    }
  }
  return { kept, reviewWarnings };
}

describe('analyze pipeline composition: pre-classify → non-authorable filter', () => {
  it('retains deterministic exclusion candidates for operator review', () => {
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
    const { kept, reviewWarnings } = runPipeline(input);
    expect(kept.map((c) => c.name)).toEqual(['AbmProvider', 'Accordion']);
    expect(kept[0]).toMatchObject({
      needsReview: true,
      reviewReasons: [expect.stringContaining('non-authorable:')],
    });
    expect(reviewWarnings).toHaveLength(1);
    expect(reviewWarnings[0]).toMatch(/AbmProvider/);
  });
});
