import { render } from 'ink-testing-library';
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HANDOFF_ENV, serializeHandoff } from '@contentful/experience-design-system-types/handoff';
import { waitForFrame } from '../../helpers/wait-for-frame.js';

const mockValidateToken = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

// ── Mock external modules BEFORE importing WizardApp ─────────────────────────

vi.mock('../../../src/apply/api-client.js', () => ({
  DEFAULT_HOST: 'https://api.contentful.com',
  ImportApiClient: vi.fn(function () {
    return {
      resolveOrganizationId: vi.fn().mockResolvedValue('org-123'),
      setOrganizationId: vi.fn(),
      validateEnvironment: vi.fn().mockResolvedValue(undefined),
      validateToken: mockValidateToken,
      previewImport: vi.fn().mockResolvedValue({
        components: { new: [], changed: [], removed: [], unchanged: [] },
        tokens: { new: [], changed: [], removed: [], unchanged: [] },
      }),
      applyImport: vi.fn().mockResolvedValue({ sys: { id: 'op-1', status: 'queued' }, items: [] }),
      pollOperation: vi.fn().mockResolvedValue({
        sys: { id: 'op-1', status: 'succeeded' },
        items: [],
        summary: { total: 0, succeeded: 0, failed: 0, pending: 0 },
      }),
    };
  }),
  ApiError: class ApiError extends Error {
    status: number;
    body: string;
    constructor(message: string, status: number, body: string) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
}));

vi.mock('@contentful/experience-design-system-generation', () => ({
  checkAgentAuth: vi.fn().mockResolvedValue('authenticated'),
}));

vi.mock('../../../src/apply/tokens.js', () => ({
  buildManifest: vi.fn().mockReturnValue({ componentsManifest: {}, tokensManifest: {} }),
  readTokensFromPath: vi.fn().mockResolvedValue([]),
  hasBreakingChangesWithImpact: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../src/session/db.js', () => ({
  openPipelineDb: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), run: vi.fn() }),
    close: vi.fn(),
  }),
  loadCDFComponents: vi.fn().mockReturnValue([]),
  seedCDFFromPreviewResponse: vi.fn().mockReturnValue(0),
  seedDefaultsFromChangedItems: vi.fn().mockReturnValue(0),
  backfillUnclassifiedProps: vi.fn(),
}));

// Mock child_process to prevent spawning real subprocesses
vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: (...args: unknown[]) => void) => {
    cb(null, '', '');
  }),
  spawn: vi.fn(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: { write: vi.fn(), end: vi.fn() },
    });
    // Simulate immediate exit with success
    setTimeout(() => child.emit('exit', 0), 10);
    return child;
  }),
}));

// Mock fs/promises access and stat to prevent real filesystem checks in the wizard
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    access: vi.fn().mockRejectedValue(new Error('ENOENT')),
    stat: vi.fn().mockResolvedValue({
      isFile: () => false,
      isDirectory: () => true,
      mtimeMs: Date.now(),
    }),
    readFile: vi.fn().mockResolvedValue('{}'),
    readdir: vi.fn().mockResolvedValue([]),
  };
});

// Mock process.exit to prevent test termination
const mockExit = vi
  .spyOn(process, 'exit')
  .mockImplementation((() => {}) as unknown as (code?: string | number | null) => never);

// ── Import WizardApp after mocks ────────────────────────────────────────────

let WizardApp: typeof import('../../../src/import/tui/WizardApp.js').WizardApp;

beforeEach(async () => {
  const mod = await import('../../../src/import/tui/WizardApp.js');
  WizardApp = mod.WizardApp;
});

// What the CLI hands the wizard once it has finished the early stages.
const startedByTheCli = (): void => {
  process.env[HANDOFF_ENV] = serializeHandoff({
    credentialsSkipped: false,
    tokens: { strategy: 'generate' },
    extraction: {
      sessionId: 'extract-session',
      outDir: '/tmp/test-project/.contentful',
      tokensPath: '',
      tokenSessionId: null,
      tokenCount: 0,
      existingEntitiesPath: null,
      existingEntitiesStatus: 'idle',
      compositionPhase: 'done',
    },
  });
};

afterEach(() => {
  delete process.env[HANDOFF_ENV];
  mockExit.mockClear();
  mockValidateToken.mockReset();
  mockValidateToken.mockResolvedValue(undefined);
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WizardApp TUI flow', () => {
  it('goes straight on from where the CLI left off, without asking for credentials', async () => {
    startedByTheCli();
    const { lastFrame } = render(<WizardApp initialProjectPath="/tmp/test-project" />);

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Starting import') || f.includes('extract session') || f.includes('failed'),
      3000,
    );

    expect(frame).not.toContain('Space ID');
    expect(frame).not.toContain('start import failed');
  });

  it('refuses to start when the CLI did not hand it anything, and says so', async () => {
    const { lastFrame } = render(<WizardApp initialProjectPath="/tmp/test-project" />);

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('failed'),
      3000,
    );

    expect(frame).toContain('start import failed');
    expect(frame).toContain('must be started by the CLI');
  });

  it('never validates credentials itself, because the new CLI already did', async () => {
    startedByTheCli();
    const { lastFrame } = render(
      <WizardApp
        initialProjectPath="/tmp/test-project"
        initialSpaceId="space1"
        initialEnvironmentId="master"
        initialCmaToken="token1"
        initialHost="https://api.eu.contentful.com"
      />,
    );

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Starting import') || f.includes('extract session') || f.includes('failed'),
      3000,
    );

    expect(mockValidateToken).not.toHaveBeenCalled();
  });
});
