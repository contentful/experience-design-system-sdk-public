import { describe, it, expect } from 'vitest';
import { buildCDF, validateSlotReferences } from '@contentful/experience-design-system-types';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { extractComponents, formatUnresolvedSlotReferences } from '../../src/apply/command.js';

describe('wizard push guard — validateSlotReferences ∘ extractComponents', () => {
  it('surfaces an unresolved reference built into a real CDF document', () => {
    const components: Array<{ key: string; entry: CDFComponentEntry }> = [
      {
        key: 'IconButton',
        entry: {
          $type: 'component',
          $properties: {},
          $slots: { children: { $allowedComponents: ['Icon'] } },
        },
      },
    ];
    const cdf = buildCDF(components, [])!;
    const extracted = extractComponents(cdf);
    const errors = validateSlotReferences(extracted);

    expect(extracted.map((c) => c.key)).toEqual(['IconButton']);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('manifest:components/IconButton/$slots/children/$allowedComponents');

    const formatted = formatUnresolvedSlotReferences(errors);
    expect(formatted.join('\n')).toMatch(/Unresolved \$allowedComponents reference/);
    expect(formatted.join('\n')).toMatch(/Icon/);
  });

  it('returns no errors when every reference resolves within the document', () => {
    const components: Array<{ key: string; entry: CDFComponentEntry }> = [
      {
        key: 'IconButton',
        entry: {
          $type: 'component',
          $properties: {},
          $slots: { children: { $allowedComponents: ['Icon'] } },
        },
      },
      { key: 'Icon', entry: { $type: 'component', $properties: {} } },
    ];
    const cdf = buildCDF(components, [])!;
    const errors = validateSlotReferences(extractComponents(cdf));
    expect(errors).toEqual([]);
  });
});
