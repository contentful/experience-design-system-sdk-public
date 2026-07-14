import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { extractReactComponents } from '../../src/analyze/extract/react.js';
import { buildManifest } from '@contentful/experience-design-system-types';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

describe('nested-component CDF manifest', () => {
  it('emits populated $allowedComponents for each typed slot', async () => {
    const fixture = join(process.cwd(), 'test/analyze/extract/fixtures/nested-layout.tsx');
    const result = await extractReactComponents([fixture]);

    const layout = result.components.find((c) => c.name === 'Layout');
    expect(layout).toBeDefined();

    const entry: CDFComponentEntry = {
      $type: 'component',
      $properties: {},
      $slots: Object.fromEntries(
        layout!.slots.map((s) => [
          s.name,
          {
            ...(s.description ? { $description: s.description } : {}),
            ...(s.allowedComponents && s.allowedComponents.length > 0
              ? { $allowedComponents: s.allowedComponents }
              : {}),
          },
        ]),
      ),
    };

    const manifest = buildManifest([{ key: 'Layout', entry }], []);
    const layoutOut = manifest.componentsManifest?.['Layout'] as CDFComponentEntry;
    expect(layoutOut).toBeDefined();
    expect(layoutOut.$slots?.header?.$allowedComponents).toEqual(['Header']);
    expect(layoutOut.$slots?.sidebar?.$allowedComponents).toEqual(['Sidebar']);
    expect(layoutOut.$slots?.footer?.$allowedComponents).toEqual(['Footer']);
  });
});
