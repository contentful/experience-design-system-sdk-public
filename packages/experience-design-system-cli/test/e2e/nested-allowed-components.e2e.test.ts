import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { extractReactComponents } from '../../src/analyze/extract/react.js';
import { buildManifest } from '@contentful/experience-design-system-types';
import type { CDFComponentEntry } from '@contentful/experience-design-system-types';

/**
 * End-to-end: run the analyze pipeline on the nested-layout fixture and assert
 * the emitted CDF manifest carries `$allowedComponents` on each typed slot.
 *
 * The full DB-backed raw→CDF conversion lives in session/db.ts; the transform
 * this test performs mirrors the shape used there (see db.ts:~1455–1472). We
 * do it inline here to keep the e2e self-contained (no SQLite required).
 */
describe('nested-component CDF manifest', () => {
  it('emits populated $allowedComponents for each typed slot', async () => {
    const fixture = join(process.cwd(), 'test/analyze/extract/fixtures/nested-layout.tsx');
    const result = await extractReactComponents([fixture]);

    const layout = result.components.find((c) => c.name === 'Layout');
    expect(layout).toBeDefined();

    // Convert Raw → CDF entry (mirror of session/db.ts logic, slot subset only).
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
