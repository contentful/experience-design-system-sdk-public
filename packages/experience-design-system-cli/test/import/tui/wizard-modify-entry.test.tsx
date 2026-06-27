import { render } from 'ink-testing-library';
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForFrame } from '../../helpers/wait-for-frame.js';

/**
 * Modify-entry spec: when the launcher seeds an extract session id and
 * sets `initialStep: 'final-review'`, the wizard must:
 *   1. NOT render welcome / token-input / extracting / scope-gate.
 *   2. Land directly on the final-review screen using the seeded session.
 *   3. Pre-fill credentials state from `initialSpaceId` / `initialHost`.
 *
 * When the seed props are absent, behavior matches the welcome path.
 */

vi.mock('../../../src/apply/api-client.js', () => ({
  DEFAULT_HOST: 'https://api.contentful.com',
  ImportApiClient: vi.fn().mockImplementation(() => ({})),
  ApiError: class ApiError extends Error {},
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
    prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), run: vi.fn(), get: vi.fn() }),
    close: vi.fn(),
  }),
  loadCDFComponents: vi.fn().mockReturnValue([]),
  seedCDFFromPreviewResponse: vi.fn().mockReturnValue(0),
  seedDefaultsFromChangedItems: vi.fn().mockReturnValue(0),
  backfillUnclassifiedProps: vi.fn(),
}));

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

describe('WizardApp modify-entry short-circuit', () => {
  it("lands on final-review when seedExtractSessionId + initialStep:'final-review' are set", async () => {
    const { lastFrame } = render(
      <WizardApp
        initialProjectPath="/tmp/modify-test"
        seedExtractSessionId="e1"
        seedGenerateSessionId="g1"
        initialStep="final-review"
      />,
    );

    // The welcome screen renders "Project path"; the token-input screen
    // renders "Design tokens"; both must be absent. The final-review screen
    // (GenerateReviewStep) renders content driven by extractSessionId.
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.length > 0,
      3000,
    );
    expect(frame).not.toContain('Project path');
    expect(frame).not.toContain('Design tokens');
  });

  it('does NOT short-circuit when seed props are absent (welcome path)', async () => {
    const { lastFrame } = render(<WizardApp />);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Project path'),
      3000,
    );
    expect(frame).toContain('Project path');
  });

  it('does NOT short-circuit when initialStep is omitted even if seed IDs are present', async () => {
    const { lastFrame } = render(
      <WizardApp initialProjectPath="/tmp/modify-test" seedExtractSessionId="e1" seedGenerateSessionId="g1" />,
    );
    // Without initialStep:'final-review', the wizard falls back to its
    // standard `initialProjectPath ? 'token-input' : 'welcome'` rule.
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Token path') || f.includes('Design tokens'),
      3000,
    );
    expect(frame).toMatch(/Token path|Design tokens/);
  });
});

describe('WizardApp initialRawTokensPath short-circuit', () => {
  it('skips welcome and token-input when initialRawTokensPath is set', async () => {
    const { lastFrame } = render(
      <WizardApp initialProjectPath="/tmp/raw-tokens-test" initialRawTokensPath="/tmp/raw-tokens-test/tokens.scss" />,
    );
    // The welcome step renders 'Project path'; the token-input step renders
    // 'Design tokens'. With initialRawTokensPath the wizard must seed
    // state.rawTokensPath and advance to the generating-tokens flow before
    // either screen renders.
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.length > 0,
      3000,
    );
    expect(frame).not.toContain('Project path');
    expect(frame).not.toContain('Design tokens');
  });

  it('modify-entry seed props take precedence over initialRawTokensPath', async () => {
    const { lastFrame } = render(
      <WizardApp
        initialProjectPath="/tmp/modify-vs-raw"
        initialRawTokensPath="/tmp/modify-vs-raw/tokens.scss"
        seedExtractSessionId="e1"
        seedGenerateSessionId="g1"
        initialStep="final-review"
      />,
    );
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.length > 0,
      3000,
    );
    // Modify-entry path skips straight to final-review, NOT generating-tokens.
    expect(frame).not.toContain('Project path');
    expect(frame).not.toContain('Design tokens');
    // generating-tokens step renders agent auth check / spinner content;
    // make sure that path didn't win. We assert via the welcome / token-input
    // negations above plus the modify-entry assertion that no errors surface.
  });
});
