import { render } from 'ink-testing-library';
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

afterEach(() => {
  mockExit.mockClear();
  mockValidateToken.mockReset();
  mockValidateToken.mockResolvedValue(undefined);
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WizardApp TUI flow', () => {
  it('starts at the credentials step', async () => {
    const { lastFrame } = render(<WizardApp initialProjectPath="/tmp/test-project" />);

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
      3000,
    );

    expect(frame).toContain('Space ID');
  });
});

describe('WizardApp TUI — EU host support', () => {
  it('silently validates prefilled credentials as soon as the credentials step opens', async () => {
    const { lastFrame } = render(
      <WizardApp
        initialRawTokensPath="/tmp/tokens.json"
        initialSpaceId="space1"
        initialEnvironmentId="master"
        initialCmaToken="token1"
      />,
    );

    await waitForFrame(
      () => lastFrame(),
      () => mockValidateToken.mock.calls.length > 0,
      3000,
    );

    expect(mockValidateToken).toHaveBeenCalled();
    expect(lastFrame()).toContain('Credentials pre-filled');
  });

  it('ignores a background validation response after the operator edits a credential', async () => {
    let resolveValidation!: () => void;
    mockValidateToken.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveValidation = resolve;
        }),
    );

    const { lastFrame, stdin } = render(
      <WizardApp
        initialRawTokensPath="/tmp/tokens.json"
        initialSpaceId="space1"
        initialEnvironmentId="master"
        initialCmaToken="token1"
      />,
    );

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Credentials pre-filled'),
      3000,
    );
    stdin.write('x');
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('space1x'),
      3000,
    );

    resolveValidation();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(lastFrame()).toContain('Credentials pre-filled');
    expect(lastFrame()).not.toContain('Push components');
  });

  it('renders without crash when initialHost is provided', async () => {
    const { lastFrame } = render(
      <WizardApp
        initialSpaceId="eu-space"
        initialEnvironmentId="master"
        initialCmaToken="eu-token"
        initialHost="https://api.eu.contentful.com"
      />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
      3000,
    );

    // A crash would produce an empty frame
    expect(frame).toContain('Space ID');
  });

  it('ImportApiClient mock is in place and receives the right host when validateCredentials fires', async () => {
    // The wizard opens on credentials, so prefilled credentials are validated straight away
    // and the client must be built against the configured host.
    const { ImportApiClient } = await import('../../../src/apply/api-client.js');
    const MockClient = vi.mocked(ImportApiClient);
    MockClient.mockClear();

    const { lastFrame } = render(
      <WizardApp
        initialRawTokensPath="/tmp/tokens.json"
        initialSpaceId="eu-space"
        initialEnvironmentId="master"
        initialCmaToken="eu-token"
        initialHost="https://api.eu.contentful.com"
      />,
    );

    await waitForFrame(
      () => lastFrame(),
      () => MockClient.mock.calls.length > 0,
      3000,
    );

    expect(JSON.stringify(MockClient.mock.calls[0])).toContain('api.eu.contentful.com');
  });

  it('renders without crash when host prop is provided as runtime fallback', async () => {
    // The configured host prop (or EDS_HOST fallback) is used when state.host is empty.
    // This test confirms the prop is accepted and the wizard mounts without error.
    const { lastFrame } = render(
      <WizardApp
        initialSpaceId="space1"
        initialEnvironmentId="master"
        initialCmaToken="tok"
        host="https://api.eu.contentful.com"
      />,
    );

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Space ID'),
      3000,
    );

    expect(frame).toContain('Space ID');
  });
});
