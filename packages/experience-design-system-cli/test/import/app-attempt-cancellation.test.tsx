import React from 'react';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const deps = vi.hoisted(() => ({
  settings: vi.fn(),
  credentialsRead: vi.fn(),
  launchError: vi.fn(),
  extraction: vi.fn(),
  navigate: undefined as ((screen: 'import') => void) | undefined,
  project: undefined as ((path: string) => void) | undefined,
  tokens: undefined as ((path: string) => void) | undefined,
  files: undefined as ((value: { filePaths: string[]; sourceInventory?: object }) => void) | undefined,
  credentials: undefined as ((value: { skipped: true }) => void) | undefined,
}));
vi.mock('@contentful/experience-design-system-types/config', () => ({ readSettings: deps.settings }));
vi.mock('../../src/tui/home/home.js', () => ({
  HomeScreen: (props: { onNavigate: typeof deps.navigate }) => {
    deps.navigate = props.onNavigate;
    return null;
  },
}));
vi.mock('../../src/tui/import/PageContainer.js', () => ({ ImportScreen: () => null }));
vi.mock('../../src/tui/import/steps/index.js', () => ({
  WelcomeScreen: (props: { onContinue: typeof deps.project }) => {
    deps.project = props.onContinue;
    return null;
  },
  TokenInputScreen: (props: { onConfirm: typeof deps.tokens }) => {
    deps.tokens = props.onConfirm;
    return null;
  },
  PathValidationScreen: (props: { onConfirm: typeof deps.files }) => {
    deps.files = props.onConfirm;
    return null;
  },
  CredentialsScreen: (props: { onDone: typeof deps.credentials }) => {
    deps.credentials = props.onDone;
    return null;
  },
  ExtractionScreen: () => null,
  TokenReuseScreen: () => null,
}));
vi.mock('../../src/tui/import/shared/index.js', () => ({ ErrorStep: deps.launchError }));
vi.mock('../../src/tui/import/steps/06-extraction/logic.js', () => ({
  resolveAgentChoice: () => ({ agent: 'claude' }),
  stepNumbers: () => ({}),
}));
vi.mock('../../src/tui/import/steps/06-extraction/use-extraction.js', () => ({ useExtraction: deps.extraction }));
vi.mock('../../src/tui/import/steps/07-scope-gate/screen.js', () => ({ ScopeGateScreen: () => null }));
vi.mock('../../src/tui/import/steps/07-scope-gate/use-scope-gate-flow.js', () => ({
  useScopeGateFlow: () => undefined,
}));
vi.mock('../../src/tui/import/steps/08-generation/screen.js', () => ({ GenerationScreen: () => null }));
vi.mock('../../src/tui/import/steps/08-generation/use-generation.js', () => ({ useGeneration: () => undefined }));
vi.mock('../../src/tui/import/steps/05-token-reuse/logic.js', () => ({ inspectTokens: async () => ({ kind: 'raw' }) }));
vi.mock('../../src/tui/import/steps/10-flow/flow/build-flow-start.js', () => ({ buildFlowStart: vi.fn() }));
vi.mock('../../src/tui/import/steps/10-flow/flow/screen.js', () => ({ FlowScreen: () => null }));
vi.mock('../../src/tui/import/steps/10-flow/flow/use-flow.js', () => ({ useFlow: () => undefined }));
vi.mock('../../src/tui/help/PageContainer.js', () => ({ HelpScreen: () => null }));
vi.mock('../../src/tui/settings/PageContainer.js', () => ({ SettingsScreen: () => null }));
vi.mock('../../src/tui/settings/configuration/ConfigurationScreen.js', () => ({
  ConfigurationScreen: () => null,
}));
vi.mock('../../src/tui/settings/opt-in-analytics/screen.js', () => ({ OptInAnalyticsScreen: () => null }));
vi.mock('../../src/tui/upgrade/PageContainer.js', () => ({ UpgradeScreen: () => null }));
vi.mock('../../src/tui/settings/debug-mode/screen.js', () => ({ DebugModeScreen: () => null }));
vi.mock('../../src/tui/settings/configuration/project/project-store.js', () => ({
  readCredentials: deps.credentialsRead,
  writeCredentials: vi.fn(),
}));
vi.mock('../../src/tui/debug-store.js', () => ({ startImportRun: async () => '/project/.contentful' }));
import { runApp } from '../../app.js';

let unmount: (() => void) | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  deps.settings.mockResolvedValue({});
  deps.credentialsRead.mockResolvedValue({});
  deps.extraction.mockReturnValue(undefined);
  deps.navigate = deps.project = deps.tokens = deps.files = deps.credentials = undefined;
});
afterEach(() => {
  unmount?.();
  unmount = undefined;
});

describe('App attempt replacement cancellation', () => {
  it.each(['AbortError', 'Error'])(
    'keeps the new attempt alive after a retired preparation rejects with %s',
    async (name) => {
      let exited!: () => void;
      const exitedPromise = new Promise<void>((resolve) => {
        exited = resolve;
      });
      const running = runApp(
        (element: React.ReactElement) => {
          const view = render(element);
          unmount = () => {
            view.unmount();
            exited();
          };
          return { waitUntilExit: () => exitedPromise };
        },
        { prompt: [], cache: true },
      );
      await vi.waitFor(() => expect(deps.navigate).toBeDefined());
      deps.navigate!('import');
      await vi.waitFor(() => expect(deps.project).toBeDefined());
      deps.project!('/project');
      await vi.waitFor(() => expect(deps.tokens).toBeDefined());
      deps.tokens!('');
      await vi.waitFor(() => expect(deps.files).toBeDefined());
      const sourceInventory = { schemaVersion: 1, files: [], selectedSourcePaths: [] };
      deps.files!({ filePaths: [], sourceInventory });
      await vi.waitFor(() => expect(deps.credentials).toBeDefined());

      let rejectOld!: (error: Error) => void;
      deps.settings.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectOld = reject;
          }),
      );
      deps.credentials!({ skipped: true });
      await vi.waitFor(() => expect(rejectOld).toBeDefined());
      deps.credentials!({ skipped: true });
      await vi.waitFor(() => expect(deps.extraction.mock.calls.some(([input]) => input?.signal)).toBe(true));
      const liveInput = deps.extraction.mock.calls.findLast(([input]) => input?.signal)?.[0] as { signal: AbortSignal };
      expect(liveInput.signal.aborted).toBe(false);
      expect(liveInput).toHaveProperty('sourceInventory', sourceInventory);

      rejectOld(Object.assign(new Error('retired preparation'), { name }));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(liveInput.signal.aborted).toBe(false);
      unmount!();
      unmount = undefined;
      await running;
    },
  );
});

it('routes failed import defaults to the actual error screen and clears them on re-entry', async () => {
  const viewRef: { view?: ReturnType<typeof render> } = {};
  void runApp(
    (element) => {
      const view = render(element);
      viewRef.view = view;
      unmount = view.unmount;
      return { waitUntilExit: () => new Promise(() => {}) };
    },
    { prompt: [], cache: true },
  );
  await vi.waitFor(() => expect(deps.navigate).toBeDefined());
  deps.credentialsRead.mockRejectedValueOnce(new Error('Defaults unavailable'));
  deps.navigate!('import');
  await vi.waitFor(() =>
    expect(deps.launchError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Defaults unavailable' }),
      expect.anything(),
    ),
  );
  expect(deps.project).toBeUndefined();
  const errorProps = deps.launchError.mock.calls.at(-1)![0];
  errorProps.onExit();
  await vi.waitFor(() => expect(deps.credentialsRead).toHaveBeenCalledOnce());
  deps.navigate!('import');
  await vi.waitFor(() => expect(deps.project).toBeDefined());
  deps.project!('/example');
  await vi.waitFor(() => expect(deps.tokens).toBeDefined());
  deps.tokens!('');
  await vi.waitFor(() => expect(deps.files).toBeDefined());
  const sourceInventory = { schemaVersion: 1, files: [], selectedSourcePaths: [] };
  deps.files!({ filePaths: [], sourceInventory });
  await vi.waitFor(() => expect(deps.credentials).toBeDefined());
  deps.settings.mockRejectedValueOnce(new Error('Preparation unavailable'));
  deps.credentials!({ skipped: true });
  await vi.waitFor(() =>
    expect(deps.launchError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Preparation unavailable', stepName: 'prepare import' }),
      expect.anything(),
    ),
  );
  expect(deps.extraction.mock.calls.some(([input]) => input?.signal)).toBe(false);
});
