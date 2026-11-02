import { describe, expect, it } from 'vitest';
import type { CDFComponentEntry, CDFPropertyDefinition, DTCGTokenEntry } from '../../../shared/index.js';
import { repairTokenKinds } from '../../src/helpers/token-kinds/repair-token-kinds.js';

const token = (path: string, $type: DTCGTokenEntry['$type']): DTCGTokenEntry => ({ path, $type, $value: 'x' });
const button = (name: string, prop: CDFPropertyDefinition): CDFComponentEntry => ({
  $type: 'component',
  $properties: { [name]: prop },
});

// The API rejects a token property with no kind, after the preview has passed. What must hold is that a token property
// never leaves generation without one: its kind is taken from the token file, or it stops being a token property.
describe('repairTokenKinds', () => {
  it('takes the kind from the tokens that carry the property name', () => {
    const tokens = [
      token('color.background', 'color'),
      token('color.border', 'color'),
      token('spacing.md', 'dimension'),
    ];
    const notes: string[] = [];

    const repaired = repairTokenKinds(
      button('color', { $type: 'token', $category: 'design' }),
      'Button',
      tokens,
      (note) => notes.push(note),
    );

    expect(repaired.$properties['color']).toMatchObject({ $type: 'token', '$token.kind': 'color' });
    expect(notes).toEqual([expect.stringContaining('Button.color')]);
  });

  it('makes it a string property when the kind cannot be told, and never leaves a kind-less token', () => {
    const noMatch = [token('spacing.md', 'dimension')];
    const ambiguous = [token('color.size', 'color'), token('text.size', 'dimension')];

    for (const tokens of [undefined, noMatch, ambiguous]) {
      const entry = button('size', { $type: 'token', $category: 'design', '$token.allowed': ['spacing.md'] });

      const repaired = repairTokenKinds(entry, 'Button', tokens).$properties['size']!;

      expect(repaired.$type).toBe('string');
      expect(repaired).not.toHaveProperty('$token.allowed');
    }
  });

  it('leaves a token property that already has a kind alone', () => {
    const entry = button('color', { $type: 'token', $category: 'design', '$token.kind': 'dimension' });

    expect(repairTokenKinds(entry, 'Button', [token('color.background', 'color')])).toBe(entry);
  });
});
