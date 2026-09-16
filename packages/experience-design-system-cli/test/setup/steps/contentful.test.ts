import { describe, expect, it, vi } from 'vitest';
import { runCredentialsSetup } from '../../../src/setup/steps/contentful.js';
import type { SetupActionEvent } from '../../../src/setup/lib/types.js';
import { createDependencies } from './dependencies.js';

describe('Contentful credentials step', () => {
  it('renders stored credential values as a plain readout, not as passed checks', async () => {
    const events: SetupActionEvent[] = [];
    const dependencies = createDependencies({
      readCredentials: async () => ({ spaceId: 'space', environmentId: 'master', cmaToken: 'token-value' }),
      confirm: async () => false,
      write: (event) => events.push(event),
    });

    await runCredentialsSetup(dependencies);

    expect(events).toContainEqual({ kind: 'value', message: 'Space ID        space' });
    expect(events).toContainEqual({ kind: 'value', message: 'Environment ID  master' });
    expect(events).toContainEqual({ kind: 'value', message: 'CMA Token       ••••••••...' });
    expect(events).toContainEqual({ kind: 'value', message: 'API Host        api.contentful.com' });
    expect(events.filter((event) => event.kind === 'success')).toEqual([
      { kind: 'success', message: 'Credentials already configured — no changes made' },
    ]);
  });

  it('flags a missing credential as a warning rather than a value', async () => {
    const events: SetupActionEvent[] = [];
    const dependencies = createDependencies({
      readCredentials: async () => ({ spaceId: 'space', environmentId: '', cmaToken: '' }),
      confirm: async () => false,
      write: (event) => events.push(event),
    });

    await runCredentialsSetup(dependencies);

    expect(events).toContainEqual({ kind: 'warning', message: 'Environment ID  (not set)' });
    expect(events).toContainEqual({ kind: 'warning', message: 'CMA Token       (not set)' });
  });

  it('renders the credentials path notice as help text followed by a spacer', async () => {
    const events: SetupActionEvent[] = [];
    const dependencies = createDependencies({ confirm: async () => false, write: (event) => events.push(event) });

    await runCredentialsSetup(dependencies);

    expect(events.slice(0, 2)).toEqual([
      {
        kind: 'help',
        message:
          'Saved to /home/tester/.config/experiences/credentials.json — loaded automatically by experiences import.',
      },
      { kind: 'info', message: '' },
    ]);
  });

  it('persists credentials collected through injected prompts', async () => {
    const writeCredentials = vi.fn();
    const dependencies = createDependencies({
      ask: vi.fn().mockResolvedValueOnce('space').mockResolvedValueOnce('staging').mockResolvedValueOnce(''),
      askSecret: async () => 'token',
      confirm: async () => true,
      writeCredentials,
    });

    await expect(runCredentialsSetup(dependencies)).resolves.toEqual({ passed: true });
    expect(writeCredentials).toHaveBeenCalledWith({
      spaceId: 'space',
      environmentId: 'staging',
      cmaToken: 'token',
    });
  });
});
