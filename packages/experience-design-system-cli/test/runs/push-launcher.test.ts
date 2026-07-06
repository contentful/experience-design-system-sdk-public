import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test launchPushWizard's prop wiring by mocking `ink` and the WizardApp
// import so that calling render captures the props passed to WizardApp
// without spinning up a real terminal. Parallel to modify-launcher.test.ts.

const { mockRender, mockWaitUntilExit, mockCreateElement, captured } = vi.hoisted(() => {
  const captured: { props?: Record<string, unknown> } = {};
  return {
    captured,
    mockWaitUntilExit: vi.fn().mockResolvedValue(undefined),
    mockRender: vi.fn(() => ({ waitUntilExit: mockWaitUntilExit })),
    mockCreateElement: vi.fn((_component: unknown, props: Record<string, unknown>) => {
      captured.props = props;
      return { __element: true };
    }),
  };
});

vi.mock('ink', () => ({ render: mockRender }));
vi.mock('react', () => ({ createElement: mockCreateElement, default: { createElement: mockCreateElement } }));
vi.mock('../../src/import/tui/WizardApp.js', () => ({
  WizardApp: function MockWizardApp() {
    return null;
  },
}));

import { launchPushWizard, pickerPushRun } from '../../src/runs/push-launcher.js';

beforeEach(() => {
  captured.props = undefined;
  mockRender.mockClear();
  mockCreateElement.mockClear();
  mockWaitUntilExit.mockClear();
});

describe('launchPushWizard prop wiring', () => {
  it("passes initialStep 'push-from-picker'", async () => {
    await launchPushWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      projectPath: '/p',
      savePath: '/p/dist',
    });
    expect(captured.props?.['initialStep']).toBe('push-from-picker');
  });

  it('threads extractSessionId as seedExtractSessionId', async () => {
    await launchPushWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      projectPath: '/p',
      savePath: '/p/dist',
    });
    expect(captured.props?.['seedExtractSessionId']).toBe('e1');
  });

  it('threads generateSessionId as seedGenerateSessionId', async () => {
    await launchPushWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      projectPath: '/p',
      savePath: '/p/dist',
    });
    expect(captured.props?.['seedGenerateSessionId']).toBe('g1');
  });

  it('omits seedGenerateSessionId when null', async () => {
    await launchPushWizard({
      extractSessionId: 'e1',
      generateSessionId: null,
      projectPath: '/p',
      savePath: '/p/dist',
    });
    expect(captured.props?.['seedGenerateSessionId']).toBeUndefined();
  });

  it('threads tokenSessionId and tokensPath when provided', async () => {
    await launchPushWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      tokenSessionId: 't1',
      tokensPath: '/p/dist/tokens.json',
      projectPath: '/p',
      savePath: '/p/dist',
    });
    expect(captured.props?.['seedTokenSessionId']).toBe('t1');
    expect(captured.props?.['seedTokensPath']).toBe('/p/dist/tokens.json');
  });

  it('threads all four credential pre-fills when provided', async () => {
    await launchPushWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      projectPath: '/p',
      savePath: '/p/dist',
      initialSpaceId: 'sp',
      initialEnvironmentId: 'env',
      initialHost: 'api.flinkly.com',
      initialCmaToken: 'tok',
    });
    expect(captured.props?.['initialSpaceId']).toBe('sp');
    expect(captured.props?.['initialEnvironmentId']).toBe('env');
    expect(captured.props?.['initialHost']).toBe('api.flinkly.com');
    expect(captured.props?.['initialCmaToken']).toBe('tok');
  });

  it('omits credential props when not provided', async () => {
    await launchPushWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      projectPath: '/p',
      savePath: '/p/dist',
    });
    expect(captured.props?.['initialSpaceId']).toBeUndefined();
    expect(captured.props?.['initialEnvironmentId']).toBeUndefined();
    expect(captured.props?.['initialHost']).toBeUndefined();
    expect(captured.props?.['initialCmaToken']).toBeUndefined();
  });
});

// pickerPushRun (the entry point wired into picker-dispatch) resolves the run
// record and layers credentials before delegating to launchPushWizard. We
// mock the helper modules and the launcher itself so the test focuses on
// dispatch decisions, not internals.
const runFixture = {
  id: '01HXYZ',
  extractSessionId: 'e1',
  generateSessionId: 'g1',
  tokenSessionId: 't1',
  projectPath: '/proj',
  savePath: '/proj/dist',
  tokensPath: '/proj/dist/tokens.json',
  pushedTo: { spaceId: 'sp-run', environmentId: 'env-run', host: 'api.flinkly.com' },
} as unknown as import('../../src/runs/store.js').RunRecord;

vi.mock('../../src/runs/resolve-run-target.js', () => ({
  resolveRunTarget: vi.fn().mockResolvedValue(runFixture),
}));

vi.mock('../../src/runs/staleness.js', () => ({
  checkRunStaleness: vi.fn().mockResolvedValue({ stale: false }),
  formatStalenessDetail: vi.fn().mockReturnValue([]),
}));

const storedCreds: { cmaToken?: string; spaceId?: string; environmentId?: string; host?: string } = {};
vi.mock('../../src/credentials-store.js', () => ({
  readExperiencesCredentials: vi.fn().mockImplementation(async () => storedCreds),
}));

describe('pickerPushRun', () => {
  beforeEach(() => {
    storedCreds.cmaToken = 'stored-token';
    storedCreds.spaceId = 'stored-sp';
    storedCreds.environmentId = 'stored-env';
    storedCreds.host = 'stored-host';
  });

  it('mounts the wizard with pushedTo values winning over stored creds', async () => {
    await pickerPushRun({ runIdOrPath: '01HXYZ' });
    // pushedTo covers spaceId/environmentId/host; cma token falls through to store
    expect(captured.props?.['initialSpaceId']).toBe('sp-run');
    expect(captured.props?.['initialEnvironmentId']).toBe('env-run');
    expect(captured.props?.['initialHost']).toBe('api.flinkly.com');
    expect(captured.props?.['initialCmaToken']).toBe('stored-token');
    expect(captured.props?.['initialStep']).toBe('push-from-picker');
    expect(captured.props?.['seedExtractSessionId']).toBe('e1');
    expect(captured.props?.['seedGenerateSessionId']).toBe('g1');
    expect(captured.props?.['seedTokenSessionId']).toBe('t1');
    expect(captured.props?.['seedTokensPath']).toBe('/proj/dist/tokens.json');
  });

  it('flag values win over pushedTo when provided', async () => {
    await pickerPushRun({
      runIdOrPath: '01HXYZ',
      spaceId: 'sp-flag',
      environmentId: 'env-flag',
      host: 'flag-host',
      cmaToken: 'flag-token',
    });
    expect(captured.props?.['initialSpaceId']).toBe('sp-flag');
    expect(captured.props?.['initialEnvironmentId']).toBe('env-flag');
    expect(captured.props?.['initialHost']).toBe('flag-host');
    expect(captured.props?.['initialCmaToken']).toBe('flag-token');
  });
});
