import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import type { ServerPreviewResponse } from '@contentful/experience-design-system-types';
import { PreviewGateScreen, type PreviewGateResult } from '../../../src/tui/import/steps/preview-gate/screen.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const plain = (frame: string | undefined): string => (frame ?? '').replace(/\u001B\[[0-9;]*m/g, '');
async function mount(element: React.ReactElement) {
  const view = render(element);
  await tick();
  return view;
}
const press = async (stdin: { write: (value: string) => void }, key: string) => {
  stdin.write(key);
  await tick();
};
const ENTER = '\r';
const ESC = '\u001B';
const DOWN = '\u001B[B';

function makePreview(overrides: Record<string, unknown> = {}): ServerPreviewResponse {
  return {
    components: { new: [], changed: [], removed: [], unchanged: [] },
    tokens: { new: [], changed: [], removed: [], unchanged: [] },
    ...overrides,
  } as unknown as ServerPreviewResponse;
}

const WITH_CHANGES = makePreview({
  components: {
    new: [{ key: 'Hero' }],
    changed: [
      {
        current: { id: 'Card', name: 'Card', contentProperties: [], designProperties: [], slots: [] },
        proposed: { $properties: { title: { $type: 'String' } } },
        hasPendingDraftChanges: false,
      },
    ],
    removed: [{ name: 'OldBanner' }],
    unchanged: [],
  },
});

function renderScreen(preview = WITH_CHANGES, hasBreakingChanges = false) {
  const onDone = vi.fn<(result: PreviewGateResult) => void>();
  const view = mount(
    <PreviewGateScreen
      preview={preview}
      spaceId="space-1"
      environmentId="master"
      hasBreakingChanges={hasBreakingChanges}
      onDone={onDone}
    />,
  );
  return { onDone, view };
}

describe('PreviewGateScreen — rendering', () => {
  it('shows the header with the space and environment', async () => {
    const { view } = renderScreen();
    const frame = plain((await view).lastFrame());
    expect(frame).toContain('Push to Contentful');
    expect(frame).toContain('Space space-1');
    expect(frame).toContain('Environment master');
  });

  it('summarises the changes by default', async () => {
    const { view } = renderScreen();
    const frame = plain((await view).lastFrame());
    expect(frame).toContain("Here's what will happen in your space:");
    expect(frame).toContain('1 components will be created');
    expect(frame).toContain('+ Hero');
    expect(frame).toContain('~ Card');
    expect(frame).toContain('⊘ OldBanner');
  });

  it('says there is nothing to push when the preview has no changes', async () => {
    const { view } = renderScreen(makePreview());
    const frame = plain((await view).lastFrame());
    expect(frame).toContain('Nothing to push');
    expect(frame).not.toContain("Here's what will happen");
  });

  it('shows the breaking-change notice only when changes are breaking', async () => {
    const quiet = plain((await renderScreen().view).lastFrame());
    const breaking = plain((await renderScreen(WITH_CHANGES, true).view).lastFrame());
    expect(quiet).not.toContain('Breaking changes will affect downstream entities');
    expect(breaking).toContain('Breaking changes will affect downstream entities');
    expect(breaking).toContain('[Enter] Acknowledge and push');
  });

  it('lists the controls, without a q shortcut', async () => {
    const { view } = renderScreen();
    const frame = plain((await view).lastFrame());
    expect(frame).toContain('[Enter] Push to Contentful');
    expect(frame).toContain('[d] Show diff');
    expect(frame).toContain('[e] Edit definitions');
    expect(frame).toContain('[Esc] Cancel');
    expect(frame).not.toContain('[q]');
  });
});

describe('PreviewGateScreen — diff view', () => {
  it('switches to the full diff on d and back on a second d', async () => {
    const { view } = renderScreen();
    const { stdin, lastFrame } = await view;

    await press(stdin, 'd');
    expect(plain(lastFrame())).toContain('Diff (');
    expect(plain(lastFrame())).toContain('+ title: String, optional');
    expect(plain(lastFrame())).toContain('[d] Hide diff');
    expect(plain(lastFrame())).toContain('Scroll / page');

    await press(stdin, 'd');
    expect(plain(lastFrame())).not.toContain('Diff (');
    expect(plain(lastFrame())).toContain('[d] Show diff');
  });

  it('scrolls a long diff and shows how many lines are hidden', async () => {
    const many = makePreview({
      tokens: {
        new: Array.from({ length: 60 }, (_, i) => ({ name: `token.${String(i).padStart(2, '0')}` })),
        changed: [],
        removed: [],
        unchanged: [],
      },
    });
    const { view } = renderScreen(many);
    const { stdin, lastFrame } = await view;

    await press(stdin, 'd');
    const before = plain(lastFrame());
    expect(before).toContain('below');
    expect(before).toContain('token.00');

    await press(stdin, DOWN);
    await press(stdin, DOWN);
    const after = plain(lastFrame());
    expect(after).toContain('2 above');
    expect(after).not.toContain('token.00');
  });
});

describe('PreviewGateScreen — exits', () => {
  it('confirms on Enter without acknowledging when nothing is breaking', async () => {
    const { onDone, view } = renderScreen();
    await press((await view).stdin, ENTER);
    expect(onDone).toHaveBeenCalledWith({ action: 'confirm', acknowledgeBreaking: false });
  });

  it('confirms on Enter and acknowledges when changes are breaking', async () => {
    const { onDone, view } = renderScreen(WITH_CHANGES, true);
    await press((await view).stdin, ENTER);
    expect(onDone).toHaveBeenCalledWith({ action: 'confirm', acknowledgeBreaking: true });
  });

  it('asks to edit on e', async () => {
    const { onDone, view } = renderScreen();
    await press((await view).stdin, 'e');
    expect(onDone).toHaveBeenCalledWith({ action: 'edit' });
  });

  it('quits on Esc but not on q', async () => {
    const { onDone, view } = renderScreen();
    const { stdin } = await view;

    await press(stdin, 'q');
    expect(onDone).not.toHaveBeenCalled();

    await press(stdin, ESC);
    expect(onDone).toHaveBeenCalledWith({ action: 'quit' });
  });

  it('does not exit on d or scroll keys', async () => {
    const { onDone, view } = renderScreen();
    const { stdin } = await view;
    await press(stdin, 'd');
    await press(stdin, DOWN);
    await press(stdin, 'f');
    expect(onDone).not.toHaveBeenCalled();
  });
});
