import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ServerPreviewConfirm } from '../../../src/apply/tui/ServerApplyView.js';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';

function previewWithRemoved(): ServerPreviewResponse {
  return {
    components: { new: [], changed: [], unchanged: [], removed: [{ name: 'OrphanedCard' }] },
    tokens: { new: [], changed: [], unchanged: [], removed: [] },
    taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
  } as unknown as ServerPreviewResponse;
}

function makeHandlers() {
  return { onConfirm: vi.fn(), onCancel: vi.fn() };
}

describe('ServerPreviewConfirm — deletion confirmation', () => {
  it('shows no deletion warning when allowDeletions is false', () => {
    const { lastFrame } = render(
      <ServerPreviewConfirm
        preview={previewWithRemoved()}
        spaceId="space"
        environmentId="master"
        breakingWithImpact={false}
        allowDeletions={false}
        {...makeHandlers()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('permanently deleted');
  });

  it('shows an explicit deletion warning when allowDeletions is true and entities will be removed', () => {
    const { lastFrame } = render(
      <ServerPreviewConfirm
        preview={previewWithRemoved()}
        spaceId="space"
        environmentId="master"
        breakingWithImpact={false}
        allowDeletions={true}
        {...makeHandlers()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('permanently deleted');
  });

  it('omits the deletion warning when allowDeletions is true but nothing is removed', () => {
    const emptyPreview = {
      components: { new: [], changed: [], unchanged: [], removed: [] },
      tokens: { new: [], changed: [], unchanged: [], removed: [] },
      taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
    } as unknown as ServerPreviewResponse;
    const { lastFrame } = render(
      <ServerPreviewConfirm
        preview={emptyPreview}
        spaceId="space"
        environmentId="master"
        breakingWithImpact={false}
        allowDeletions={true}
        {...makeHandlers()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('permanently deleted');
  });
});
