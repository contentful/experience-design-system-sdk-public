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

function previewWithRemovedComponent(): ServerPreviewResponse {
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
  it('renders removed entities as skipped by default, with no deletion warning', () => {
    const preview = previewWithRemovedComponent();
    const { lastFrame } = render(
      <WizardPreviewStep
        preview={preview}
        spaceId="space"
        environmentId="master"
        stepNumber={1}
        totalSteps={1}
        {...makeHandlers()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('will be skipped');
    expect(frame).not.toContain('will be deleted');
    expect(frame).not.toContain('permanently deleted');
    expect(frame).toContain('Also delete 1');
  });

  it('omits the deletion toggle hint when nothing is removed', () => {
    const { lastFrame } = render(
      <WizardPreviewStep
        preview={emptyPreview()}
        spaceId="space"
        environmentId="master"
        stepNumber={1}
        totalSteps={1}
        {...makeHandlers()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Also delete');
  });

  it('pressing x toggles to delete wording and shows the deletion warning', () => {
    const preview = previewWithRemovedComponent();
    const { lastFrame, stdin } = render(
      <WizardPreviewStep
        preview={preview}
        spaceId="space"
        environmentId="master"
        stepNumber={1}
        totalSteps={1}
        {...makeHandlers()}
      />,
    );
    stdin.write('x');
    const frame = lastFrame() ?? '';
    expect(frame).toContain('will be deleted');
    expect(frame).not.toContain('will be skipped');
    expect(frame).toContain('permanently deleted');
  });

  it('starts with delete wording when initialAllowDeletions is true', () => {
    const preview = previewWithRemovedComponent();
    const { lastFrame } = render(
      <WizardPreviewStep
        preview={preview}
        spaceId="space"
        environmentId="master"
        stepNumber={1}
        totalSteps={1}
        initialAllowDeletions
        {...makeHandlers()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('will be deleted');
  });

  it('passes the current deletion choice to onConfirm on Enter', () => {
    const preview = previewWithRemovedComponent();
    const onConfirm = vi.fn();
    const { stdin } = render(
      <WizardPreviewStep
        preview={preview}
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
    expect(onConfirm).toHaveBeenCalledWith(false, true);
  });

  it('x is a no-op when there is nothing removed', () => {
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
