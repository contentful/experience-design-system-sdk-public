import { describe, it, expect } from 'vitest';
import { buildManifest, validateManifestSlotReferences } from '@contentful/experience-design-system-types';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';
import { extractComponentsFromManifest, formatUnresolvedSlotReferences } from '../../src/apply/command.js';

describe('wizard push guard — validateManifestSlotReferences ∘ extractComponentsFromManifest', () => {
  it('surfaces an unresolved reference built into a real ManifestPayload', () => {
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
    const manifest = buildManifest(components, []);
    const extracted = extractComponentsFromManifest(manifest);
    const errors = validateManifestSlotReferences(extracted);

    expect(extracted.map((c) => c.key)).toEqual(['IconButton']);
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('manifest:components/IconButton/$slots/children/$allowedComponents');

    const formatted = formatUnresolvedSlotReferences(errors);
    expect(formatted.join('\n')).toMatch(/Unresolved \$allowedComponents reference/);
    expect(formatted.join('\n')).toMatch(/Icon/);
  });

  it('returns no errors when every reference resolves within the manifest', () => {
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
    const manifest = buildManifest(components, []);
    const errors = validateManifestSlotReferences(extractComponentsFromManifest(manifest));
    expect(errors).toEqual([]);
  });
});
