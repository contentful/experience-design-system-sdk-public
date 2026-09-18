import { describe, expect, it } from 'vitest';
import { parseImportedNames } from '@contentful/experience-design-system-extraction';

describe('parseImportedNames', () => {
  it('extracts default, namespace, and named import locals', () => {
    expect(parseImportedNames('React, * as Runtime, { Button as Panel }')).toEqual([
      'React',
      '*',
      'Button',
    ]);
  });

  it('returns an empty list for an empty import clause', () => {
    expect(parseImportedNames('  ')).toEqual([]);
  });
});
