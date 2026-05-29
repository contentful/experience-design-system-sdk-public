import { render } from 'ink-testing-library';
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForFrame } from '../../helpers/wait-for-frame.js';

// ── Mock external modules BEFORE importing WizardApp ─────────────────────────

vi.mock('../../../src/apply/api-client.js', () => ({
  ImportApiClient: vi.fn().mockImplementation(() => ({
    resolveOrganizationId: vi.fn().mockResolvedValue('org-123'),
    setOrganizationId: vi.fn(),
    validateEnvironment: vi.fn().mockResolvedValue(undefined),
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
  })),
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

vi.mock('../../../src/generate/agent-runner.js', () => ({
  checkAgentAuth: vi.fn().mockResolvedValue('authenticated'),
}));

vi.mock('../../../src/apply/manifest.js', () => ({
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
  vi.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WizardApp TUI flow', () => {
  it('shows welcome step on initial render (no project path)', async () => {
    const { lastFrame } = render(<WizardApp />);

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('import'),
      3000,
    );

    // TopBar renders "import" and welcome step renders project path prompt
    expect(frame).toContain('import');
    expect(frame).toContain('Project path');
  });

  it('skips to token-input step when initialProjectPath is provided', async () => {
    const { lastFrame } = render(<WizardApp initialProjectPath="/tmp/test-project" />);

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('token') || f.includes('Token'),
      3000,
    );

    // TokenInputStep renders "Design tokens" heading and token path prompt
    expect(frame).toContain('Design tokens');
    expect(frame).toContain('Token path');
  });

  it('token-input step responds to skip keystroke', async () => {
    const { lastFrame, stdin } = render(<WizardApp initialProjectPath="/tmp/test-project" />);

    // Wait for token-input step to render
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Token path'),
      3000,
    );

    // Press 's' to skip tokens — should advance to path-validation step
    stdin.write('s');

    // PathValidationStep shows "Scanning" or the project path
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Scanning') || f.includes('/tmp/test-project'),
      3000,
    );

    expect(frame).toContain('/tmp/test-project');
  });

  it('quit works from welcome step', async () => {
    const { lastFrame, stdin } = render(<WizardApp />);

    // Wait for welcome step to render
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Project path'),
      3000,
    );

    // Press 'q' to quit
    stdin.write('q');

    // Wait a tick for the effect to fire
    await new Promise((r) => setTimeout(r, 100));

    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it('quit works from token-input step', async () => {
    const { lastFrame, stdin } = render(<WizardApp initialProjectPath="/tmp/test-project" />);

    // Wait for token-input step
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Token path'),
      3000,
    );

    // Press 'q' to quit
    stdin.write('q');

    await new Promise((r) => setTimeout(r, 100));

    expect(mockExit).toHaveBeenCalledWith(0);
  });
});
