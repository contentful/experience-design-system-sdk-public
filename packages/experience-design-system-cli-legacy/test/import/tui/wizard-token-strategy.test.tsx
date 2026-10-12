import { render } from 'ink-testing-library';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// v2 asks about an existing tokens.json and tells the wizard its answer in EDS_IMPORT_TOKENS. The only visible
// difference between "regenerate" and "generate" is whether token generation is told to skip the cache.
const spawned: string[][] = [];

vi.mock('@contentful/experience-design-system-generation', () => ({
  checkAgentAuth: vi.fn().mockResolvedValue('authenticated'),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: (...args: unknown[]) => void) => cb(null, '', '')),
  spawn: vi.fn((_cmd: string, args: string[]) => {
    spawned.push(args);
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: vi.fn(), end: vi.fn() },
    });
    setTimeout(() => child.emit('exit', 0), 5);
    return child;
  }),
}));

vi.spyOn(process, 'exit').mockImplementation((() => {}) as unknown as (code?: string | number | null) => never);

const tokenGenerations = (): string[][] =>
  spawned.filter((args) => args.includes('__generate') && args.includes('tokens'));

async function renderWizard(strategy: string | undefined): Promise<ReturnType<typeof render>> {
  if (strategy === undefined) delete process.env.EDS_IMPORT_TOKENS;
  else process.env.EDS_IMPORT_TOKENS = strategy;
  process.env.EDS_IMPORT_SKIP_CREDENTIALS = '1';

  const { WizardApp } = await import('../../../src/import/tui/WizardApp.js');
  const app = render(<WizardApp initialProjectPath="/tmp/project" initialRawTokensPath="/tmp/raw-tokens.json" />);
  await new Promise((resolve) => setTimeout(resolve, 150));
  return app;
}

describe('WizardApp token strategy from v2', () => {
  beforeEach(() => {
    spawned.length = 0;
  });

  afterEach(() => {
    delete process.env.EDS_IMPORT_TOKENS;
    delete process.env.EDS_IMPORT_SKIP_CREDENTIALS;
  });

  it('generates tokens the normal way when nothing was asked', async () => {
    const app = await renderWizard('generate');
    expect(tokenGenerations()).toHaveLength(1);
    expect(tokenGenerations()[0]).not.toContain('--no-cache');
    app.unmount();
  });

  it('generates tokens with the cache off when the user chose to regenerate', async () => {
    const app = await renderWizard('regenerate');
    expect(tokenGenerations()).toHaveLength(1);
    expect(tokenGenerations()[0]).toContain('--no-cache');
    app.unmount();
  });

  it('does not generate tokens when the user chose to reuse them', async () => {
    const app = await renderWizard('reuse');
    expect(tokenGenerations()).toHaveLength(0);
    app.unmount();
  });

  it('generates tokens the normal way when v2 sent no answer', async () => {
    const app = await renderWizard(undefined);
    expect(tokenGenerations()).toHaveLength(1);
    expect(tokenGenerations()[0]).not.toContain('--no-cache');
    app.unmount();
  });
});
