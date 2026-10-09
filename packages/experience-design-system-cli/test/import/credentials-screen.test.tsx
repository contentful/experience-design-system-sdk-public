import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { CredentialsScreen } from '../../src/tui/import/steps/04-credentials/screen.js';

const tick = () => new Promise((resolve) => setTimeout(resolve, 60));
const plain = (frame: string | undefined): string => (frame ?? '').replace(/\u001B\[[0-9;]*m/g, '');
const type = async (stdin: { write: (value: string) => void }, text: string) => {
  stdin.write(text);
  await tick();
};
async function mount(element: React.ReactElement) {
  const view = render(element);
  await tick();
  return view;
}
const ENTER = '\r';
const TAB = '\t';
const ESC = '\u001B';
const CTRL_S = '\u0013';

const filled = { spaceId: 'sp', environmentId: 'master', cmaToken: 'tok', host: 'api.contentful.com' };

async function submitAll(stdin: { write: (value: string) => void }) {
  for (let i = 0; i < 4; i++) await type(stdin, ENTER);
}

describe('CredentialsScreen', () => {
  it('pre-fills saved credentials and masks the token', async () => {
    const { lastFrame } = await mount(<CredentialsScreen initial={filled} onDone={vi.fn()} onBack={vi.fn()} />);
    const frame = plain(lastFrame());
    expect(frame).toContain('pre-filled');
    expect(frame).toContain('sp');
    expect(frame).toContain('•••');
    expect(frame).not.toContain('tok');
  });

  it('validates and returns the credentials on continue', async () => {
    const onDone = vi.fn();
    const validate = vi.fn().mockResolvedValue({ ok: true });
    const { stdin } = await mount(
      <CredentialsScreen initial={filled} onDone={onDone} onBack={vi.fn()} validate={validate} />,
    );
    await submitAll(stdin);
    await tick();
    await tick();
    expect(validate).toHaveBeenCalledWith(filled);
    expect(onDone).toHaveBeenCalledWith({ skipped: false, credentials: filled });
  });

  it('shows a validation error inline and stays on the screen', async () => {
    const onDone = vi.fn();
    const validate = vi.fn().mockResolvedValue({ ok: false, error: 'CMA token is invalid or revoked.' });
    const { stdin, lastFrame } = await mount(
      <CredentialsScreen initial={filled} onDone={onDone} onBack={vi.fn()} validate={validate} />,
    );
    await submitAll(stdin);
    await tick();
    await tick();
    expect(plain(lastFrame())).toContain('CMA token is invalid or revoked.');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('requires space, environment and token', async () => {
    const validate = vi.fn();
    const { stdin, lastFrame } = await mount(
      <CredentialsScreen initial={{ environmentId: 'master' }} onDone={vi.fn()} onBack={vi.fn()} validate={validate} />,
    );
    await submitAll(stdin);
    expect(plain(lastFrame())).toContain('are all required');
    expect(validate).not.toHaveBeenCalled();
  });

  it('skips with Ctrl+S without validating', async () => {
    const onDone = vi.fn();
    const validate = vi.fn();
    const { stdin } = await mount(<CredentialsScreen onDone={onDone} onBack={vi.fn()} validate={validate} />);
    await type(stdin, CTRL_S);
    expect(onDone).toHaveBeenCalledWith({ skipped: true });
    expect(validate).not.toHaveBeenCalled();
  });

  it('does not skip when the letter s is typed into a field', async () => {
    const onDone = vi.fn();
    const { stdin, lastFrame } = await mount(<CredentialsScreen onDone={onDone} onBack={vi.fn()} />);
    await type(stdin, 's');
    expect(onDone).not.toHaveBeenCalled();
    expect(plain(lastFrame())).toContain('Space ID: s');
  });

  it('goes back on Esc and moves between fields on Tab', async () => {
    const onBack = vi.fn();
    const { stdin, lastFrame } = await mount(<CredentialsScreen onDone={vi.fn()} onBack={onBack} />);
    await type(stdin, TAB);
    await type(stdin, 'prod');
    expect(plain(lastFrame())).toContain('Environment: masterprod');
    await type(stdin, ESC);
    expect(onBack).toHaveBeenCalled();
  });

  it('shows the host default hint on the host field', async () => {
    const { stdin, lastFrame } = await mount(<CredentialsScreen initial={filled} onDone={vi.fn()} onBack={vi.fn()} />);
    for (let i = 0; i < 3; i++) await type(stdin, TAB);
    expect(plain(lastFrame())).toContain('EU spaces: api.eu.contentful.com');
  });
});
