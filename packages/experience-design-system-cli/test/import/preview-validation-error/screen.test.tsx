import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { PreviewValidationErrorScreen } from '../../../src/tui/import/steps/preview-validation-error/screen.js';
import type { PreviewValidationError } from '../../../src/tui/import/steps/preview-validation-error/logic.js';

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

const SLOT: PreviewValidationError = {
  componentName: 'PageLink',
  path: 'manifest:components/PageLink/$slots/',
  message: 'Slot id must be a non-empty string',
};
const PROP: PreviewValidationError = {
  componentName: 'Button',
  path: 'manifest:components/Button/$properties/variant',
  message: 'variant required',
};

function handlers() {
  return { onEdit: vi.fn(), onSkip: vi.fn(), onQuit: vi.fn() };
}

describe('PreviewValidationErrorScreen — rendering', () => {
  it('shows the failure header as an error, not a success', async () => {
    const { lastFrame } = await mount(
      <PreviewValidationErrorScreen errors={[SLOT]} missingNames={[]} {...handlers()} />,
    );
    const frame = plain(lastFrame());
    expect(frame).toContain('✗ Preview validation failed');
    expect(frame).not.toContain('✓');
  });

  it('lists each error with its component, path and message', async () => {
    const { lastFrame } = await mount(
      <PreviewValidationErrorScreen errors={[SLOT, PROP]} missingNames={[]} {...handlers()} />,
    );
    const frame = plain(lastFrame()).replace(/\s+/g, ' ');
    expect(frame).toContain('Slot id must be a non-empty string');
    expect(frame).toContain('Component: PageLink');
    expect(frame).toContain('Path: manifest:components/PageLink/$slots/');
    expect(frame).toContain('variant required');
    expect(frame).toContain('Component: Button');
  });

  it('names the component in the skip label when one failed, and counts when several did', async () => {
    const one = await mount(<PreviewValidationErrorScreen errors={[SLOT]} missingNames={[]} {...handlers()} />);
    expect(plain(one.lastFrame())).toContain('Skip PageLink and retry');
    const many = await mount(<PreviewValidationErrorScreen errors={[SLOT, PROP]} missingNames={[]} {...handlers()} />);
    expect(plain(many.lastFrame())).toContain('Skip 2 components and retry');
  });

  it('explains server component names that do not exist in this session', async () => {
    const { lastFrame } = await mount(
      <PreviewValidationErrorScreen
        errors={[SLOT, { ...PROP, componentName: 'Phantom' }]}
        missingNames={['Phantom']}
        {...handlers()}
      />,
    );
    const frame = plain(lastFrame());
    expect(frame).toContain('Phantom');
    expect(frame).toContain('does not match anything');
  });

  it('hides the skip option when every failed component is missing from the session', async () => {
    const { lastFrame } = await mount(
      <PreviewValidationErrorScreen errors={[SLOT]} missingNames={['PageLink']} {...handlers()} />,
    );
    const frame = plain(lastFrame());
    expect(frame).not.toContain('[a]');
    expect(frame).toContain('[Enter] Edit definitions');
  });
});

describe('PreviewValidationErrorScreen — keys', () => {
  it('Enter edits', async () => {
    const h = handlers();
    const { stdin } = await mount(<PreviewValidationErrorScreen errors={[SLOT]} missingNames={[]} {...h} />);
    await press(stdin, ENTER);
    expect(h.onEdit).toHaveBeenCalledTimes(1);
    expect(h.onSkip).not.toHaveBeenCalled();
    expect(h.onQuit).not.toHaveBeenCalled();
  });

  it('a skips when components are matched', async () => {
    const h = handlers();
    const { stdin } = await mount(<PreviewValidationErrorScreen errors={[SLOT]} missingNames={[]} {...h} />);
    await press(stdin, 'a');
    expect(h.onSkip).toHaveBeenCalledTimes(1);
    expect(h.onEdit).not.toHaveBeenCalled();
  });

  it('a does nothing when every component is missing', async () => {
    const h = handlers();
    const { stdin } = await mount(<PreviewValidationErrorScreen errors={[SLOT]} missingNames={['PageLink']} {...h} />);
    await press(stdin, 'a');
    expect(h.onSkip).not.toHaveBeenCalled();
  });

  it('Esc quits, and q does not', async () => {
    const h = handlers();
    const { stdin } = await mount(<PreviewValidationErrorScreen errors={[SLOT]} missingNames={[]} {...h} />);
    await press(stdin, 'q');
    expect(h.onQuit).not.toHaveBeenCalled();
    await press(stdin, ESC);
    expect(h.onQuit).toHaveBeenCalledTimes(1);
  });

  it('never calls process.exit itself', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { stdin } = await mount(<PreviewValidationErrorScreen errors={[SLOT]} missingNames={[]} {...handlers()} />);
    await press(stdin, ENTER);
    await press(stdin, ESC);
    expect(exit).not.toHaveBeenCalled();
    exit.mockRestore();
  });
});
