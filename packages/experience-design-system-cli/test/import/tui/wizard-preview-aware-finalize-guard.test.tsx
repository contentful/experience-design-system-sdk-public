import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { EventEmitter } from 'node:events';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * INTEG-4411 refined: the wizard's no-op push check consults the preview
 * response, not the accepted count. When the FinalReviewHost fires
 * onFinalize(0, N, U):
 *   - If preview response is fully empty (no components / tokens / taxonomies
 *     in any bucket), route back to final-review with the inline banner.
 *   - If preview response contains ANY change (e.g. a REMOVAL from an
 *     explicit rejection of a server-side component, or a token diff),
 *     proceed. Test drives the wizard through the noSave path so we can
 *     observe the preview-gate transition.
 */

const previewMock = vi.fn();

vi.mock('../../../src/apply/api-client.js', () => ({
  DEFAULT_HOST: 'https://api.contentful.com',
  ImportApiClient: vi.fn().mockImplementation(function () {
    return {
      previewImport: previewMock,
      validateToken: vi.fn().mockResolvedValue(undefined),
      resolveOrganizationId: vi.fn().mockResolvedValue('org-1'),
      setOrganizationId: vi.fn(),
      validateEnvironment: vi.fn().mockResolvedValue(undefined),
    };
  }),
  ApiError: class ApiError extends Error {
    status = 0;
    body = '';
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
    prepare: vi.fn().mockReturnValue({ all: vi.fn().mockReturnValue([]), run: vi.fn(), get: vi.fn() }),
    close: vi.fn(),
  }),
  loadCDFComponents: vi.fn().mockReturnValue([]),
  seedCDFFromPreviewResponse: vi.fn().mockReturnValue(0),
  seedDefaultsFromChangedItems: vi.fn().mockReturnValue(0),
  backfillUnclassifiedProps: vi.fn(),
}));

// FinalReviewHost mock fires onFinalize(0, 1, 0) on mount — pure rejection
// scenario. Also records the `initialFinalizeError` prop so we can assert
// whether the wizard routed a banner back after an empty preview.
const initialFinalizeErrorHistory: Array<string | null | undefined> = [];
vi.mock('../../../src/import/tui/final-review-host.js', () => ({
  FinalReviewHost: ({
    onFinalize,
    initialFinalizeError,
  }: {
    onFinalize: (accepted: number, rejected: number, unresolved: number) => void;
    initialFinalizeError?: string | null;
  }) => {
    initialFinalizeErrorHistory.push(initialFinalizeError);
    const firedRef = React.useRef(false);
    React.useEffect(() => {
      if (firedRef.current) return;
      if (initialFinalizeError) return;
      firedRef.current = true;
      onFinalize(0, 1, 0);
    }, [initialFinalizeError, onFinalize]);
    return React.createElement(
      Text,
      null,
      initialFinalizeError ? `BANNER:${initialFinalizeError}` : 'MOCK_FINAL_REVIEW',
    );
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
  initialFinalizeErrorHistory.length = 0;
  previewMock.mockReset();
  const mod = await import('../../../src/import/tui/WizardApp.js');
  WizardApp = mod.WizardApp;
});

afterEach(() => {
  mockExit.mockClear();
  vi.clearAllMocks();
});

const emptyBuckets = { new: [], changed: [], removed: [], unchanged: [] };

describe('WizardApp — preview-aware finalize guard (INTEG-4411 refined)', () => {
  it('routes BACK to final-review with a banner when preview is fully empty (pure no-op)', async () => {
    previewMock.mockResolvedValue({
      components: { ...emptyBuckets },
      tokens: { ...emptyBuckets },
      taxonomies: { ...emptyBuckets },
    });

    const { lastFrame } = render(
      <WizardApp
        initialProjectPath="/tmp/empty-preview-test"
        initialSpaceId="sp"
        initialEnvironmentId="master"
        initialCmaToken="t"
        initialHost="h"
        seedExtractSessionId="e1"
        seedGenerateSessionId="g1"
        initialStep="final-review"
        noSave
      />,
    );
    await new Promise((r) => setTimeout(r, 200));
    const frame = lastFrame() ?? '';
    expect(frame).toContain('BANNER:');
    expect(frame).toMatch(/Nothing to push/);
    const banners = initialFinalizeErrorHistory.filter((b) => !!b);
    expect(banners.length).toBeGreaterThan(0);
    expect(banners[0]).toMatch(/Nothing to push/);
  });

  it('proceeds when preview contains a REMOVAL (rejection targeting a server-side component)', async () => {
    previewMock.mockResolvedValue({
      components: {
        new: [],
        changed: [],
        removed: [{ id: 'r1', name: 'Legacy', contentProperties: [], designProperties: [], slots: [] }],
        unchanged: [],
      },
      tokens: { ...emptyBuckets },
      taxonomies: { ...emptyBuckets },
    });

    const { lastFrame } = render(
      <WizardApp
        initialProjectPath="/tmp/removal-preview-test"
        initialSpaceId="sp"
        initialEnvironmentId="master"
        initialCmaToken="t"
        initialHost="h"
        seedExtractSessionId="e1"
        seedGenerateSessionId="g1"
        initialStep="final-review"
        noSave
      />,
    );
    await new Promise((r) => setTimeout(r, 200));
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('BANNER:');
    const banners = initialFinalizeErrorHistory.filter((b) => !!b);
    expect(banners.length).toBe(0);
    expect(previewMock).toHaveBeenCalled();
  });

  it('proceeds when preview contains a token-only diff', async () => {
    previewMock.mockResolvedValue({
      components: { ...emptyBuckets },
      tokens: {
        new: [{ $type: 'color', $value: '#fff' }],
        changed: [],
        removed: [],
        unchanged: [],
      },
      taxonomies: { ...emptyBuckets },
    });

    const { lastFrame } = render(
      <WizardApp
        initialProjectPath="/tmp/token-only-preview-test"
        initialSpaceId="sp"
        initialEnvironmentId="master"
        initialCmaToken="t"
        initialHost="h"
        seedExtractSessionId="e1"
        seedGenerateSessionId="g1"
        initialStep="final-review"
        noSave
      />,
    );
    await new Promise((r) => setTimeout(r, 200));
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('BANNER:');
    const banners = initialFinalizeErrorHistory.filter((b) => !!b);
    expect(banners.length).toBe(0);
    expect(previewMock).toHaveBeenCalled();
  });
});
