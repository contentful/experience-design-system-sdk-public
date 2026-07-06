import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test launchModifyWizard's prop wiring by mocking `ink` and the WizardApp
// import so that calling render captures the props passed to WizardApp without
// spinning up a real terminal.

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

import { launchModifyWizard } from '../../src/runs/modify-launcher.js';

beforeEach(() => {
  captured.props = undefined;
  mockRender.mockClear();
  mockCreateElement.mockClear();
  mockWaitUntilExit.mockClear();
});

describe('launchModifyWizard prop wiring', () => {
  it('threads extractSessionId as seedExtractSessionId', async () => {
    await launchModifyWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      projectPath: '/p',
      savePath: '/p/dist',
      entryStep: 'final-review',
      saveMode: 'prompt',
    });
    expect(captured.props?.['seedExtractSessionId']).toBe('e1');
  });

  it('threads generateSessionId as seedGenerateSessionId', async () => {
    await launchModifyWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      projectPath: '/p',
      savePath: '/p/dist',
      entryStep: 'final-review',
      saveMode: 'prompt',
    });
    expect(captured.props?.['seedGenerateSessionId']).toBe('g1');
  });

  it('omits seedGenerateSessionId when generateSessionId is null', async () => {
    await launchModifyWizard({
      extractSessionId: 'e1',
      generateSessionId: null,
      projectPath: '/p',
      savePath: '/p/dist',
      entryStep: 'final-review',
      saveMode: 'prompt',
    });
    expect(captured.props?.['seedGenerateSessionId']).toBeUndefined();
  });

  it("passes initialStep when entryStep is 'final-review'", async () => {
    await launchModifyWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      projectPath: '/p',
      savePath: '/p/dist',
      entryStep: 'final-review',
      saveMode: 'prompt',
    });
    expect(captured.props?.['initialStep']).toBe('final-review');
  });

  it('threads tokenSessionId as seedTokenSessionId when set', async () => {
    await launchModifyWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      tokenSessionId: 't1',
      projectPath: '/p',
      savePath: '/p/dist',
      entryStep: 'final-review',
      saveMode: 'prompt',
    });
    expect(captured.props?.['seedTokenSessionId']).toBe('t1');
  });

  it('omits seedTokenSessionId when tokenSessionId is null', async () => {
    await launchModifyWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      tokenSessionId: null,
      projectPath: '/p',
      savePath: '/p/dist',
      entryStep: 'final-review',
      saveMode: 'prompt',
    });
    expect(captured.props?.['seedTokenSessionId']).toBeUndefined();
  });

  it('threads creds from initialSpaceId / initialEnvironmentId / initialHost when provided', async () => {
    await launchModifyWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      projectPath: '/p',
      savePath: '/p/dist',
      entryStep: 'final-review',
      saveMode: 'prompt',
      initialSpaceId: 'sp',
      initialEnvironmentId: 'env',
      initialHost: 'api.flinkly.com',
    });
    expect(captured.props?.['initialSpaceId']).toBe('sp');
    expect(captured.props?.['initialEnvironmentId']).toBe('env');
    expect(captured.props?.['initialHost']).toBe('api.flinkly.com');
  });

  it('threads initialCmaToken when provided', async () => {
    await launchModifyWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      projectPath: '/p',
      savePath: '/p/dist',
      entryStep: 'final-review',
      saveMode: 'prompt',
      initialCmaToken: 'tok',
    });
    expect(captured.props?.['initialCmaToken']).toBe('tok');
  });

  it('omits initialCmaToken when not provided', async () => {
    await launchModifyWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      projectPath: '/p',
      savePath: '/p/dist',
      entryStep: 'final-review',
      saveMode: 'prompt',
    });
    expect(captured.props?.['initialCmaToken']).toBeUndefined();
  });

  it('omits cred props when run record has no pushedTo', async () => {
    await launchModifyWizard({
      extractSessionId: 'e1',
      generateSessionId: 'g1',
      projectPath: '/p',
      savePath: '/p/dist',
      entryStep: 'final-review',
      saveMode: 'prompt',
    });
    expect(captured.props?.['initialSpaceId']).toBeUndefined();
    expect(captured.props?.['initialEnvironmentId']).toBeUndefined();
    expect(captured.props?.['initialHost']).toBeUndefined();
  });
});
