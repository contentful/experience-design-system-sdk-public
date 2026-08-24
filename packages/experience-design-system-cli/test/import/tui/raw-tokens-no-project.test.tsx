import { render } from 'ink-testing-library';
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForFrame } from '../../helpers/wait-for-frame.js';

vi.mock('../../../src/apply/api-client.js', () => ({
  DEFAULT_HOST: 'https://api.contentful.com',
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

vi.mock('@contentful/experience-design-system-generation', () => ({
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

// Stands in for the real "generate tokens" / "print tokens" subprocesses —
// this test is about the wizard's state transitions, not the subprocess I/O.
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
    setTimeout(() => child.emit('exit', 0), 10);
    return child;
  }),
}));

// node:fs/promises is intentionally NOT mocked — the bug is a real
// fs.stat('') call inside PathValidationStep, and we need the real
// ENOENT to distinguish "fixed" from "still broken."

const mockExit = vi
  .spyOn(process, 'exit')
  .mockImplementation((() => {}) as unknown as (code?: string | number | null) => never);

let WizardApp: typeof import('../../../src/import/tui/WizardApp.js').WizardApp;

beforeEach(async () => {
  const mod = await import('../../../src/import/tui/WizardApp.js');
  WizardApp = mod.WizardApp;
});

afterEach(() => {
  mockExit.mockClear();
  vi.clearAllMocks();
});

describe('raw-tokens-only import with no --project', () => {
  it('does not route through path-validation on an empty project path', async () => {
    // Equivalent to: experiences import --raw-tokens ./tokens.json
    // (no --project, so initialProjectPath is undefined, matching
    // command.ts's `opts.project !== '.' ? resolve(opts.project) : undefined`)
    const { lastFrame } = render(<WizardApp initialRawTokensPath="/tmp/fake-raw-tokens.json" noPush />);

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Generating token definitions'),
      3000,
    );

    // Once the mocked "generate tokens" / "print tokens" subprocesses exit,
    // the wizard must NOT show the empty-path "Directory not found" screen.
    // It should instead move on to the save flow (path-prompt step).
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Directory not found') || f.includes('Save') || f.includes('save'),
      3000,
    );

    expect(frame).not.toContain('Directory not found');
  });
});
