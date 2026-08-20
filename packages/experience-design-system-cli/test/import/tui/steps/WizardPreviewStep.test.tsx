import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { buildPreviewDiffLines, WizardPreviewStep } from '../../../../src/import/tui/steps/WizardPreviewStep.js';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';

function emptyPreview(): ServerPreviewResponse {
  return {
    components: { new: [], changed: [], unchanged: [], removed: [] },
    tokens: { new: [], changed: [], unchanged: [], removed: [] },
    taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
  };
}

function previewWithFetchedRemoval(): ServerPreviewResponse {
  const preview = emptyPreview();
  preview.components.removed = [{ name: 'OrphanedCard' } as ServerPreviewResponse['components']['removed'][number]];
  return preview;
}

function makeHandlers() {
  return {
    onConfirm: vi.fn(),
    onQuit: vi.fn(),
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
        ...({ key: 'Card' } as Record<string, unknown>),
      } as unknown as ServerPreviewResponse['components']['new'][number],
    ];

    const lines = buildPreviewDiffLines(preview);
    const texts = lines.map((l) => l.text);
    expect(texts).toEqual(expect.arrayContaining([expect.stringContaining('slot: header')]));
    expect(texts).toEqual(expect.arrayContaining([expect.stringContaining('allowedComponents: [Heading]')]));
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

describe('WizardPreviewStep — deletion confirmation', () => {
  it('does not render the hidden-deletions hint when fetched with allowDeletions: true', () => {
    const { lastFrame } = render(
      <WizardPreviewStep
        preview={emptyPreview()}
        spaceId="space"
        environmentId="master"
        stepNumber={1}
        totalSteps={1}
        allowDeletions
        {...makeHandlers()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Deletions are hidden by default');
  });

  it('renders the full removal list and a toggle hint when fetched with allowDeletions: true', () => {
    const preview = previewWithFetchedRemoval();
    const { lastFrame } = render(
      <WizardPreviewStep
        preview={preview}
        spaceId="space"
        environmentId="master"
        stepNumber={1}
        totalSteps={1}
        allowDeletions
        {...makeHandlers()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('will be deleted');
    expect(frame).toContain('Allow deletions');
  });

  it('pressing x opts OUT of a deletion that was fetched with allowDeletions: true', () => {
    const preview = previewWithFetchedRemoval();
    const { lastFrame, stdin } = render(
      <WizardPreviewStep
        preview={preview}
        spaceId="space"
        environmentId="master"
        stepNumber={1}
        totalSteps={1}
        allowDeletions
        {...makeHandlers()}
      />,
    );
    stdin.write('x');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('will be skipped');
    expect(frame).not.toContain('will be deleted');
  });

  it('pressing x is a no-op when the preview was fetched with allowDeletions: false', () => {
    const { lastFrame, stdin } = render(
      <WizardPreviewStep
        preview={emptyPreview()}
        spaceId="space"
        environmentId="master"
        stepNumber={1}
        totalSteps={1}
        {...makeHandlers()}
      />,
    );
    stdin.write('x');
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('will be deleted');
  });

  it('passes the current (possibly opted-out) deletion choice to onConfirm on Enter', () => {
    const preview = previewWithFetchedRemoval();
    const onConfirm = vi.fn();
    const { stdin } = render(
      <WizardPreviewStep
        preview={preview}
        spaceId="space"
        environmentId="master"
        stepNumber={1}
        totalSteps={1}
        allowDeletions
        onConfirm={onConfirm}
        onQuit={() => {}}
      />,
    );
    stdin.write('x');
    stdin.write('\r');
    expect(onConfirm).toHaveBeenCalledWith(false, false);
  });

  it('onConfirm always reports false when the preview was fetched with allowDeletions: false', () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <WizardPreviewStep
        preview={emptyPreview()}
        spaceId="space"
        environmentId="master"
        stepNumber={1}
        totalSteps={1}
        onConfirm={onConfirm}
        onQuit={() => {}}
      />,
    );
    stdin.write('x');
    stdin.write('\r');
    expect(onConfirm).toHaveBeenCalledWith(false, false);
  });
});
