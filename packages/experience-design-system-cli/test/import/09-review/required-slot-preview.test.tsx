import { expect, it } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { ApiClient } from '@contentful/experience-design-system-backend-pipeline';
import {
  buildBreakingRows,
  deriveBreakingChanges,
} from '../../../src/tui/import/steps/09-review/generate-review-step.js';
import { formatBreakingChange } from '../../../src/tui/import/steps/09-review/helpers/breaking-change-format.js';
import { vi } from 'vitest';
it('carries required-slot reasons through the real API sanitizer and wizard detail/focus rows', async () => {
  const response = {
    components: {
      new: [],
      changed: [
        {
          current: {
            id: 'example',
            name: 'Example',
            contentProperties: [],
            designProperties: [],
            slots: ['constructor'],
            fullProperties: {
              future: {
                type: 'Future',
                category: 'content',
                required: false,
                targetDefinition: { type: 'Future', extension: { $ref: 'opaque' } },
              },
            },
          },
          proposed: { $type: 'component', $properties: {}, $slots: { constructor: { $required: true } } },
          hasPendingDraftChanges: false,
          changeClassification: {
            classification: 'breaking',
            breakingChanges: [
              { slotId: 'constructor', reason: 'slot_became_required' },
              { slotId: 'new', reason: 'slot_added_required' },
              { slotId: 'bad', propertyId: 'bad', reason: 'removed' },
            ],
          },
        },
      ],
      unchanged: [],
      removed: [],
    },
    tokens: { new: [], changed: [], unchanged: [], removed: [] },
    taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
  };
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetch);
  try {
    const client = new ApiClient({
      host: 'https://api.example.com',
      spaceId: 'example',
      environmentId: 'example',
      cmaToken: 'example',
    });
    const preview = await client.previewImport({ $schema: 'https://contentful.com/schemas/cdf' } as never);
    expect(preview.components.changed[0]!.changeClassification?.classification).toBe('breaking');
    expect(preview.components.changed[0]!.current.fullProperties).toEqual(
      response.components.changed[0]!.current.fullProperties,
    );
    const rows = buildBreakingRows(deriveBreakingChanges(preview));
    expect(rows.map((row) => row.focusTarget)).toEqual([
      { kind: 'slot', name: 'constructor' },
      { kind: 'slot', name: 'new' },
    ]);
    expect(rows.map((row) => row.label)).toEqual(['constructor — slot now required', 'new — new required slot']);
    const ui = render(<Text>{rows.map((row) => row.label).join('\n')}</Text>);
    try {
      expect(ui.lastFrame()).toContain('new required slot');
    } finally {
      ui.unmount();
    }
    const malformed = structuredClone(preview) as ServerPreviewResponse;
    malformed.components.changed[0]!.changeClassification!.breakingChanges = [];
    expect(buildBreakingRows(deriveBreakingChanges(malformed))[0]!.label).toBe('Example — breaking');
    expect(formatBreakingChange({ slotId: '__proto__', reason: 'slot_added_required' })).toBe(
      '__proto__ — new required slot',
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
