import { describe, it, expect } from 'vitest';
import { buildPreviewDiffLines } from '../../../../src/import/tui/steps/WizardPreviewStep.js';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';

function emptyPreview(): ServerPreviewResponse {
  return {
    components: { new: [], changed: [], unchanged: [], removed: [] },
    tokens: { new: [], changed: [], unchanged: [], removed: [] },
    taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
  };
}

describe('buildPreviewDiffLines', () => {
  it('renders slot names and $allowedComponents for a new component', () => {
    const preview = emptyPreview();
    preview.components.new = [
      {
        $type: 'component',
        $properties: {},
        $slots: {
          header: { $allowedComponents: ['Heading'] },
        },
        // The key/name is stored as a private field on the entry in this codebase.
        // The existing implementation reads `key` or `$name` off the entry via unknown-casting.
        ...({ key: 'Card' } as Record<string, unknown>),
      } as unknown as ServerPreviewResponse['components']['new'][number],
    ];

    const lines = buildPreviewDiffLines(preview);
    const texts = lines.map((l) => l.text);
    expect(texts).toEqual(expect.arrayContaining([expect.stringContaining('slot: header')]));
    expect(texts).toEqual(
      expect.arrayContaining([expect.stringContaining('allowedComponents: [Heading]')]),
    );
  });

  it('does not render an allowedComponents line when the list is empty', () => {
    const preview = emptyPreview();
    preview.components.new = [
      {
        $type: 'component',
        $properties: {},
        $slots: { footer: {} },
        ...({ key: 'Card' } as Record<string, unknown>),
      } as unknown as ServerPreviewResponse['components']['new'][number],
    ];
    const lines = buildPreviewDiffLines(preview);
    expect(lines.some((l) => l.text.includes('allowedComponents'))).toBe(false);
  });
});
