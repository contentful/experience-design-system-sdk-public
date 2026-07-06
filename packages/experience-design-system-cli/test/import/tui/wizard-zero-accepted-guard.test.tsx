import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { EventEmitter } from 'node:events';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * INTEG-4411 belt-and-braces: if the GenerateReviewStep guard is somehow
 * bypassed and onFinalize fires with `accepted === 0`, the wizard must
 * refuse to advance to push-decision-gate and stay on the final-review
 * screen with an inline banner so the operator can accept at least one
 * component.
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

// Force the FinalReviewHost to call onFinalize(0, 0, 3) on mount so we can
// pin the wizard's zero-accepted guard behavior.
vi.mock('../../../src/import/tui/final-review-host.js', () => ({
  FinalReviewHost: ({
    onFinalize,
  }: {
    onFinalize: (accepted: number, rejected: number, unresolved: number) => void;
  }) => {
    React.useEffect(() => {
      onFinalize(0, 0, 3);
    }, []);
    return React.createElement(Text, null, 'MOCK_FINAL_REVIEW');
  },
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

describe('WizardApp — zero-accepted finalize belt-and-braces (INTEG-4411)', () => {
  it('does NOT advance to push-decision-gate when onFinalize fires with accepted=0', async () => {
    const { lastFrame } = render(
      <WizardApp
        initialProjectPath="/tmp/zero-accepted-test"
        seedExtractSessionId="e1"
        seedGenerateSessionId="g1"
        initialStep="final-review"
      />,
    );
    // Wait for the mock's useEffect to fire onFinalize(0,0,3) and for the
    // wizard to react. Without the guard, this transitions to
    // push-decision-gate which renders "Generation complete".
    await new Promise((r) => setTimeout(r, 100));
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Generation complete');
    expect(frame).toContain('MOCK_FINAL_REVIEW');
  });
});
