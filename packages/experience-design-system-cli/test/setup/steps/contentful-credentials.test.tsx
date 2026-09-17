import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ContentfulScreen, envShadowingWarning, maskToken } from '../../../src/setup/steps/contentful-credentials.js';
import { waitForFrame } from '../../helpers/wait-for-frame.js';

const credentialsStore = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
}));

vi.mock('../../../src/credentials-store.js', () => ({
  readExperiencesCredentials: credentialsStore.read,
  writeExperiencesCredentials: credentialsStore.write,
  experiencesCredentialsPath: () => '/home/tester/.config/experiences/credentials.json',
}));

const EMPTY = { spaceId: '', environmentId: '', cmaToken: '' };

function renderScreen(stored: Record<string, unknown> = EMPTY) {
  credentialsStore.read.mockReset().mockResolvedValue(stored);
  credentialsStore.write.mockReset().mockResolvedValue(undefined);
  const onDone = vi.fn();
  return { ...render(<ContentfulScreen onDone={onDone} />), onDone, write: credentialsStore.write };
}

/** Type a value and submit it, the way a terminal delivers a pasted answer. */
async function answer(stdin: { write: (data: string) => void }, text: string): Promise<void> {
  if (text) stdin.write(text);
  await new Promise((resolve) => setTimeout(resolve, 30));
  stdin.write('\r');
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe('envShadowingWarning', () => {
  it('names every Contentful env var that would act as a fallback', () => {
    expect(envShadowingWarning({ CONTENTFUL_SPACE_ID: 's', EDS_HOST: 'h' })).toContain('CONTENTFUL_SPACE_ID, EDS_HOST');
  });

  it('is silent when no relevant env var is set', () => {
    expect(envShadowingWarning({ PATH: '/usr/bin' })).toBeNull();
  });
});

describe('maskToken', () => {
  it('masks up to eight characters regardless of token length', () => {
    expect(maskToken('short')).toBe('•••••...');
    expect(maskToken('a-very-long-cma-token')).toBe('••••••••...');
  });
});

describe('ContentfulScreen', () => {
  it('shows stored values as a plain readout, not as passed checks', async () => {
    const { lastFrame } = renderScreen({ spaceId: 'space', environmentId: 'master', cmaToken: 'token-value' });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Current values'),
    );

    expect(frame).toContain('Space ID        space');
    expect(frame).toContain('Environment ID  master');
    expect(frame).toContain('CMA Token       ••••••••...');
    expect(frame).toContain('API Host        api.contentful.com');
    expect(frame).not.toContain('✓ Space ID');
  });

  it('flags a missing credential as a warning rather than a value', async () => {
    const { lastFrame } = renderScreen({ spaceId: 'space', environmentId: '', cmaToken: '' });

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Current values'),
    );

    expect(frame).toContain('⚠ Environment ID  (not set)');
    expect(frame).toContain('⚠ CMA Token       (not set)');
  });

  it('renders the credentials path as dimmed help text', async () => {
    const { lastFrame } = renderScreen();

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('loaded automatically'),
    );

    expect(frame).toContain('Saved to /home/tester/.config/experiences/credentials.json');
  });

  it('skips without writing when the operator declines', async () => {
    const { lastFrame, stdin, onDone, write } = renderScreen({
      spaceId: 'space',
      environmentId: 'master',
      cmaToken: 'token',
    });

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Update credentials?'),
    );
    stdin.write('n');
    await new Promise((r) => setTimeout(r, 60));

    expect(onDone).toHaveBeenCalledWith('skipped');
    expect(write).not.toHaveBeenCalled();
  });

  it('persists every field the operator enters', async () => {
    const { lastFrame, stdin, onDone, write } = renderScreen();

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Configure Contentful credentials?'),
    );
    stdin.write('y');
    await new Promise((r) => setTimeout(r, 80));

    for (const [prompt, value] of [
      ['Space ID:', 'space'],
      ['Environment ID', 'staging'],
      ['CMA token', 'token'],
      ['API host', ''],
    ] as const) {
      await waitForFrame(
        () => lastFrame(),
        (f) => f.includes(prompt),
      );
      await answer(stdin, value);
    }

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'space', environmentId: 'staging', cmaToken: 'token' }),
    );
    expect(onDone).toHaveBeenCalledWith('completed');
  });

  // Each field renders an input at the same tree position, so without distinct
  // keys React reuses one instance and the previous value leaks into the next
  // field — which saved the Space ID as the Environment ID.
  it('defaults the environment to master when the field is left empty', async () => {
    const { lastFrame, stdin, write } = renderScreen();

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Configure Contentful credentials?'),
    );
    stdin.write('y');
    await new Promise((r) => setTimeout(r, 80));

    for (const [prompt, value] of [
      ['Space ID:', 'space'],
      ['Environment ID', ''],
      ['CMA token', 'token'],
      ['API host', ''],
    ] as const) {
      await waitForFrame(
        () => lastFrame(),
        (f) => f.includes(prompt),
      );
      await answer(stdin, value);
    }

    expect(write).toHaveBeenCalledWith(expect.objectContaining({ environmentId: 'master' }));
  });

  it('reports failure when a required field ends up empty', async () => {
    const { lastFrame, stdin, onDone, write } = renderScreen();

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Configure Contentful credentials?'),
    );
    stdin.write('y');
    await new Promise((r) => setTimeout(r, 80));

    for (const prompt of ['Space ID:', 'Environment ID', 'CMA token', 'API host'] as const) {
      await waitForFrame(
        () => lastFrame(),
        (f) => f.includes(prompt),
      );
      await answer(stdin, '');
    }

    expect(write).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith('failed');
  });
});
