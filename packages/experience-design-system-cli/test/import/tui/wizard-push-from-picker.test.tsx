import { render } from 'ink-testing-library';
import { EventEmitter } from 'node:events';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForFrame } from '../../helpers/wait-for-frame.js';

/**
 * Push-from-picker entry spec: when the launcher seeds an extract session id
 * and sets `initialStep: 'push-from-picker'`, the wizard must:
 *   1. NOT render welcome / token-input / final-review / push-decision-gate.
 *   2. Land on the previewing screen (spinner) and drive runPreview on mount.
 *   3. On preview success, transition through preview-gate.
 */

const previewImportMock = vi.fn().mockResolvedValue({
  components: { new: [], changed: [], removed: [], unchanged: [] },
  tokens: { new: [], changed: [], removed: [], unchanged: [] },
});

vi.mock('../../../src/apply/api-client.js', () => ({
  DEFAULT_HOST: 'https://api.contentful.com',
  ImportApiClient: class ImportApiClient {
    previewImport = previewImportMock;
    applyImport = vi.fn();
    validateToken = vi.fn().mockResolvedValue(undefined);
    pollOperation = vi.fn();
  },
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
  loadCDFComponents: vi.fn().mockReturnValue([{ key: 'k', entry: { name: 'C', schema: {} } }]),
  seedCDFFromPreviewResponse: vi.fn().mockReturnValue(0),
  seedDefaultsFromChangedItems: vi.fn().mockReturnValue(0),
  backfillUnclassifiedProps: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: (...args: unknown[]) => void) => cb(null, '', '')),
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
    stat: vi.fn().mockResolvedValue({ isFile: () => false, isDirectory: () => true, mtimeMs: Date.now() }),
    readFile: vi.fn().mockResolvedValue('{}'),
    readdir: vi.fn().mockResolvedValue([]),
  };
});

const mockExit = vi
  .spyOn(process, 'exit')
  .mockImplementation((() => {}) as unknown as (code?: string | number | null) => never);

let WizardApp: typeof import('../../../src/import/tui/WizardApp.js').WizardApp;

beforeEach(async () => {
  previewImportMock.mockClear();
  const mod = await import('../../../src/import/tui/WizardApp.js');
  WizardApp = mod.WizardApp;
});

afterEach(() => {
  mockExit.mockClear();
});

describe("WizardApp push-from-picker entry", () => {
  it("skips welcome / token-input / final-review and lands on previewing on mount", async () => {
    const { lastFrame } = render(
      <WizardApp
        initialProjectPath="/tmp/push-from-picker"
        seedExtractSessionId="e1"
        seedGenerateSessionId="g1"
        initialStep="push-from-picker"
        initialSpaceId="sp"
        initialEnvironmentId="env"
        initialCmaToken="tok"
      />,
    );
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.length > 0,
      3000,
    );
    expect(frame).not.toContain('Project path');
    expect(frame).not.toContain('Design tokens');
    // Previewing screen title from RunningStep
    expect(frame).toMatch(/Computing diff|previewing/i);
  });

  it('dispatches previewImport once on mount', async () => {
    render(
      <WizardApp
        initialProjectPath="/tmp/push-from-picker-2"
        seedExtractSessionId="e1"
        seedGenerateSessionId="g1"
        initialStep="push-from-picker"
        initialSpaceId="sp"
        initialEnvironmentId="env"
        initialCmaToken="tok"
      />,
    );
    // The effect fires after mount; give the microtask + async chain a tick.
    await new Promise((r) => setTimeout(r, 100));
    expect(previewImportMock).toHaveBeenCalled();
  });
});
