import { render } from 'ink-testing-library';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HANDOFF_ENV,
  serializeHandoff,
  type ExtractionHandoff,
} from '@contentful/experience-design-system-types/handoff';

// While the user is still looking at the scope gate, the wizard checks in the background which components are already
// generated, so that confirming the scope can go straight on. That check starts only when extraction has fully settled.
// The CLI now does the extraction, so the wizard has to see that same settled state in what the CLI hands it.
const cliCalls: string[][] = [];

vi.mock('@contentful/experience-design-system-generation', () => ({
  checkAgentAuth: vi.fn().mockResolvedValue('authenticated'),
}));

vi.mock('../../../src/session/db.js', () => ({
  openPipelineDb: vi.fn().mockReturnValue({
    // no component rows, so the check cannot be answered from the database and has to ask the CLI
    prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), run: vi.fn() }),
    close: vi.fn(),
  }),
  loadScopeComponents: vi.fn().mockReturnValue([{ name: 'Card', componentId: 'card', aiDecision: 'accepted' }]),
  loadCDFComponents: vi.fn().mockReturnValue([]),
  seedCDFFromPreviewResponse: vi.fn().mockReturnValue(0),
  seedDefaultsFromChangedItems: vi.fn().mockReturnValue(0),
  backfillUnclassifiedProps: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, args: string[], cb: (...a: unknown[]) => void) => {
    cliCalls.push(args);
    cb(null, 'cache-components=\n', '');
  }),
  spawn: vi.fn(() => {
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

const settled: ExtractionHandoff = {
  sessionId: 'extract-session',
  outDir: '/tmp/proj/.contentful',
  tokensPath: '/tmp/proj/.contentful/tokens.json',
  tokenSessionId: 'tok-1',
  tokenCount: 3,
  existingEntitiesPath: '/tmp/proj/.contentful/.existing-entities.json',
  existingEntitiesStatus: 'complete',
  compositionPhase: 'done',
};

async function startWith(
  extraction: Partial<ExtractionHandoff>,
  props: { noCache?: boolean; credentialsSkipped?: boolean } = {},
): Promise<void> {
  process.env[HANDOFF_ENV] = serializeHandoff({
    credentialsSkipped: props.credentialsSkipped ?? false,
    tokens: { strategy: 'generate' },
    extraction: { ...settled, ...extraction },
  });
  const { WizardApp } = await import('../../../src/import/tui/WizardApp.js');
  const app = render(
    <WizardApp
      initialProjectPath="/tmp/proj"
      initialRawTokensPath="/tmp/raw-tokens.json"
      noCache={props.noCache ?? false}
    />,
  );
  await new Promise((resolve) => setTimeout(resolve, 400));
  app.unmount();
}

const cacheChecks = (): string[][] => cliCalls.filter((args) => args.includes('--cache-status'));

describe('the scope gate background cache check, started from a handoff', () => {
  beforeEach(() => {
    cliCalls.length = 0;
  });

  afterEach(() => {
    delete process.env[HANDOFF_ENV];
  });

  it('starts once extraction has fully settled', async () => {
    await startWith({});
    expect(cacheChecks()).not.toHaveLength(0);
    expect(cacheChecks()[0]).toEqual(expect.arrayContaining(['--session', 'extract-session']));
  });

  it('starts when composition came from the cache', async () => {
    await startWith({ compositionPhase: 'cache-hit' });
    expect(cacheChecks()).not.toHaveLength(0);
  });

  it('starts when the existing entities could not be fetched, since that has settled too', async () => {
    await startWith({ existingEntitiesStatus: 'failed', existingEntitiesPath: null });
    expect(cacheChecks()).not.toHaveLength(0);
  });

  it('does not start when credentials were skipped and no entities were fetched, as before', async () => {
    await startWith({ existingEntitiesStatus: 'idle', existingEntitiesPath: null }, { credentialsSkipped: true });
    expect(cacheChecks()).toHaveLength(0);
  });

  it('does not start with the cache turned off', async () => {
    await startWith({}, { noCache: true });
    expect(cacheChecks()).toHaveLength(0);
  });
});
