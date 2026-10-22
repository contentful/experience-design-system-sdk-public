import { render } from 'ink-testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const deps = vi.hoisted(() => ({
  debugRead: vi.fn(),
  debugWrite: vi.fn(),
  analyticsRead: vi.fn(),
  analyticsWrite: vi.fn(),
  configRead: vi.fn(),
  configWrite: vi.fn(),
  finish: vi.fn(),
  helpRead: vi.fn(),
  start: vi.fn(),
}));
vi.mock('../src/tui/settings/debug-mode/debug-mode-store.js', () => ({
  readDebugModeSetting: deps.debugRead,
  writeDebugModeSetting: deps.debugWrite,
}));
vi.mock('../src/tui/settings/opt-in-analytics/analytics-store.js', () => ({
  readAnalyticsSetting: deps.analyticsRead,
  writeAnalyticsSetting: deps.analyticsWrite,
}));
vi.mock('../src/tui/settings/configuration/project/project-store.js', () => ({
  readCredentials: deps.configRead,
  writeCredentials: deps.configWrite,
}));
vi.mock('../src/tui/debug-store.js', () => ({
  startDebugRun: deps.start,
  finishDebugRun: deps.finish,
  startDebugSessionIn: vi.fn(),
}));
vi.mock('../src/tui/help/help-info.js', () => ({ readHelpInfo: deps.helpRead }));
import { HelpScreen } from '../src/tui/help/PageContainer.js';
import { DebugModeScreen } from '../src/tui/settings/debug-mode/screen.js';
import { OptInAnalyticsScreen } from '../src/tui/settings/opt-in-analytics/screen.js';
import { ConfigurationScreen } from '../src/tui/settings/configuration/ConfigurationScreen.js';
let unmount: (() => void) | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  deps.finish.mockResolvedValue(undefined);
  deps.debugRead.mockResolvedValue({ enabled: true });
  deps.analyticsRead.mockResolvedValue({ enabled: true });
  deps.configRead.mockResolvedValue({ cmaToken: 'example-token' });
});
afterEach(() => {
  unmount?.();
  unmount = undefined;
});
const screens = [
  ['debug', DebugModeScreen, deps.debugRead, deps.debugWrite],
  ['analytics', OptInAnalyticsScreen, deps.analyticsRead, deps.analyticsWrite],
  ['configuration', ConfigurationScreen, deps.configRead, deps.configWrite],
] as const;
it.each(screens)(
  '%s load failure settles visibly and exits without writable damaged state',
  async (_name, Screen, read, write) => {
    read.mockRejectedValue(new Error('Unable to read /example/config.json'));
    const done = vi.fn();
    const view = render(<Screen onDone={done} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.lastFrame()).toContain('/example/config.json'));
    expect(view.lastFrame()).not.toContain('Loading');
    expect(view.lastFrame()).not.toContain('toggle');
    expect(view.lastFrame()).not.toContain('Space ID');
    await new Promise((resolve) => setTimeout(resolve, 10));
    view.stdin.write('q');
    await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(write).not.toHaveBeenCalled();
  },
);
it.each(screens.slice(0, 2))(
  '%s preference save waits for storage and reports failure truthfully',
  async (_name, Screen, _read, write) => {
    let reject!: (error: Error) => void;
    write.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const done = vi.fn();
    const view = render(<Screen onDone={done} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.lastFrame()).toContain('On'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    view.stdin.write(' ');
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(view.lastFrame()).not.toContain('Off');
    reject(new Error('Preference write failed'));
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Preference write failed'));
    view.stdin.write('q');
    await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(deps.finish).not.toHaveBeenCalledWith(expect.objectContaining({ exitMethod: 'saved' }));
  },
);

it('help settles a settings failure visibly and can return', async () => {
  deps.helpRead.mockRejectedValue(new Error('Help settings unavailable'));
  const done = vi.fn();
  const view = render(<HelpScreen onDone={done} />);
  unmount = view.unmount;
  await vi.waitFor(() => expect(view.lastFrame()).toContain('Help settings unavailable'));
  expect(view.lastFrame()).not.toContain('Loading');
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write('q');
  await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
});
it.each(screens)('%s ignores a load completed after departure', async (_name, Screen, read) => {
  let finish!: (value: never) => void;
  read.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<Screen onDone={vi.fn()} />);
  unmount = view.unmount;
  await vi.waitFor(() => expect(finish).toBeDefined());
  view.unmount();
  unmount = undefined;
  await new Promise<void>((resolve) => setImmediate(resolve));
  finish({ enabled: true, spaceId: 'example' } as never);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(deps.start).not.toHaveBeenCalled();
});
it.each(screens)('%s ignores save success after departure', async (_name, Screen, _read, write) => {
  let finish!: () => void;
  write.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const done = vi.fn();
  const view = render(<Screen onDone={done} />);
  unmount = view.unmount;
  await vi.waitFor(() => expect(view.lastFrame()).not.toContain('Loading'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write(_name === 'configuration' ? 's' : ' ');
  await vi.waitFor(() => expect(finish).toBeDefined());
  view.stdin.write('q');
  await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
  view.unmount();
  unmount = undefined;
  finish();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(deps.finish).not.toHaveBeenCalledWith(expect.objectContaining({ exitMethod: 'saved' }));
});

it.each(screens)('%s re-entry clears a prior load error', async (_name, Screen, read) => {
  read.mockRejectedValueOnce(new Error('Prior load failed'));
  const first = render(<Screen onDone={vi.fn()} />);
  unmount = first.unmount;
  await vi.waitFor(() => expect(first.lastFrame()).toContain('Prior load failed'));
  first.unmount();
  const view = render(<Screen onDone={vi.fn()} />);
  unmount = view.unmount;
  await vi.waitFor(() => expect(view.lastFrame()).toContain(_name === 'configuration' ? 'Space ID' : 'On'));
  expect(view.lastFrame()).not.toContain('Prior load failed');
});
it.each(screens.slice(0, 2))(
  '%s preference shows a completed write and records a saved exit',
  async (_name, Screen, _read, write) => {
    let finish!: () => void;
    write.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const done = vi.fn();
    const view = render(<Screen onDone={done} />);
    unmount = view.unmount;
    await vi.waitFor(() => expect(view.lastFrame()).toContain('On'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    view.stdin.write(' ');
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(view.lastFrame()).not.toContain('Off');
    finish();
    await vi.waitFor(() => expect(view.lastFrame()).toContain('Off'));
    view.stdin.write('q');
    await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(deps.finish).toHaveBeenCalledWith(
      expect.objectContaining({ outputs: { enabled: false }, status: 'success', exitMethod: 'saved' }),
    );
  },
);
it('configuration masks credentials and shows save failure followed by successful storage and saved exit', async () => {
  let reject!: (error: Error) => void;
  deps.configWrite.mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const done = vi.fn();
  const view = render(<ConfigurationScreen onDone={done} />);
  unmount = view.unmount;
  await vi.waitFor(() => expect(view.lastFrame()).toContain('Space ID'));
  expect(view.lastFrame()).not.toContain('example-token');
  expect(view.lastFrame()).toContain('Root Project Directory');
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write('s');
  await vi.waitFor(() => expect(reject).toBeDefined());
  expect(view.lastFrame()).not.toContain('Configuration saved');
  reject(new Error('Configuration write failed'));
  await vi.waitFor(() => expect(view.lastFrame()).toContain('Configuration write failed'));
  deps.configWrite.mockResolvedValueOnce(undefined);
  view.stdin.write('s');
  await vi.waitFor(() => expect(view.lastFrame()).toContain('Configuration saved'));
  view.stdin.write('q');
  await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(deps.finish).toHaveBeenCalledWith(expect.objectContaining({ exitMethod: 'saved', status: 'success' }));
});

it('configuration pending save tells the user a submitted write may finish after leaving', async () => {
  let finish!: () => void;
  deps.configWrite.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<ConfigurationScreen onDone={vi.fn()} />);
  unmount = view.unmount;
  await vi.waitFor(() => expect(view.lastFrame()).toContain('Space ID'));
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write('s');
  await vi.waitFor(() => expect(finish).toBeDefined());
  await vi.waitFor(() => expect(view.lastFrame()).toContain('save may still finish'));
  view.stdin.write('q');
  finish();
});
