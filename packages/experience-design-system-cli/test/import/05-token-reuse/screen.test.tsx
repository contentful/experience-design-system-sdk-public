import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { TokenReuseScreen } from '../../../src/tui/import/steps/05-token-reuse/screen.js';

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

function renderScreen(sourceChanged = false) {
  const handlers = { onReuse: vi.fn(), onRegenerate: vi.fn(), onQuit: vi.fn() };
  const view = mount(
    <TokenReuseScreen tokensPath="/p/.contentful/tokens.json" sourceChanged={sourceChanged} {...handlers} />,
  );
  return { handlers, view };
}

describe('TokenReuseScreen — rendering', () => {
  it('announces the existing tokens.json and where it is', async () => {
    const { view } = renderScreen();
    const frame = plain((await view).lastFrame());
    expect(frame).toContain('Existing tokens.json found');
    expect(frame).toContain('Tokens Path: /p/.contentful/tokens.json');
    expect(frame).toContain('Source file has not changed');
  });

  it('recommends regenerating only when the source changed', async () => {
    const same = plain((await renderScreen(false).view).lastFrame());
    const changed = plain((await renderScreen(true).view).lastFrame());
    expect(same).not.toContain('regenerating is recommended');
    expect(changed).toContain('Source file has been modified');
    expect(changed).toContain('regenerating is recommended');
  });

  it('offers reuse, regenerate and quit', async () => {
    const frame = plain((await renderScreen().view).lastFrame());
    expect(frame).toContain('[Enter] Reuse existing tokens');
    expect(frame).toContain('[a] Regenerate tokens');
    expect(frame).toContain('[Esc] Quit');
  });
});

describe('TokenReuseScreen — choices', () => {
  it('reuses on Enter', async () => {
    const { handlers, view } = renderScreen();
    await press((await view).stdin, ENTER);
    expect(handlers.onReuse).toHaveBeenCalledTimes(1);
    expect(handlers.onRegenerate).not.toHaveBeenCalled();
    expect(handlers.onQuit).not.toHaveBeenCalled();
  });

  it('regenerates on a', async () => {
    const { handlers, view } = renderScreen();
    await press((await view).stdin, 'a');
    expect(handlers.onRegenerate).toHaveBeenCalledTimes(1);
    expect(handlers.onReuse).not.toHaveBeenCalled();
  });

  it('quits on Esc and not on q', async () => {
    const { handlers, view } = renderScreen();
    const { stdin } = await view;
    await press(stdin, 'q');
    expect(handlers.onQuit).not.toHaveBeenCalled();
    await press(stdin, ESC);
    expect(handlers.onQuit).toHaveBeenCalledTimes(1);
  });
});
