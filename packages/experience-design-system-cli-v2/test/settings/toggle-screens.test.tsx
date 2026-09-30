import { render } from 'ink-testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugModeScreen } from '../../src/tui/settings/debug-mode/screen.js';
import { OptInAnalyticsScreen } from '../../src/tui/settings/opt-in-analytics/screen.js';

const ESC = '\u001B';
const ENTER = '\r';

const stores = vi.hoisted(() => ({
  readAnalyticsSetting: vi.fn(),
  writeAnalyticsSetting: vi.fn(),
  readDebugModeSetting: vi.fn(),
  writeDebugModeSetting: vi.fn(),
}));

vi.mock('../../src/tui/settings/opt-in-analytics/analytics-store.js', () => ({
  readAnalyticsSetting: stores.readAnalyticsSetting,
  writeAnalyticsSetting: stores.writeAnalyticsSetting,
}));

vi.mock('../../src/tui/settings/debug-mode/debug-mode-store.js', () => ({
  readDebugModeSetting: stores.readDebugModeSetting,
  writeDebugModeSetting: stores.writeDebugModeSetting,
}));

const SCREENS = [
  {
    name: 'OptInAnalyticsScreen',
    Screen: OptInAnalyticsScreen,
    title: 'Settings › Opt-in Analytics',
    label: 'Share anonymous usage data:',
    read: stores.readAnalyticsSetting,
    write: stores.writeAnalyticsSetting,
  },
  {
    name: 'DebugModeScreen',
    Screen: DebugModeScreen,
    title: 'Settings › Debug Mode',
    label: 'Debug logging:',
    read: stores.readDebugModeSetting,
    write: stores.writeDebugModeSetting,
  },
];

beforeEach(() => {
  for (const store of Object.values(stores)) store.mockReset();
});

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function plain(frame: string | undefined): string {
  return (frame ?? '').replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
}

describe.each(SCREENS)('$name', ({ Screen, title, label, read, write }) => {
  async function renderScreen(enabled: boolean) {
    read.mockResolvedValue({ enabled });
    write.mockResolvedValue(undefined);
    const onDone = vi.fn();
    const instance = render(<Screen onDone={onDone} />);
    await flush();
    return { ...instance, onDone };
  }

  it('shows its title and the saved value once loaded', async () => {
    const { lastFrame } = await renderScreen(false);

    const frame = plain(lastFrame());
    expect(frame).toContain(title);
    expect(frame).toContain(`${label} Off`);
    expect(frame).toContain('[Enter/Space] Toggle [Esc/q] Back to Settings');
  });

  it('shows Loading… until the saved value arrives, and ignores keys meanwhile', async () => {
    read.mockReturnValue(new Promise(() => {}));
    write.mockResolvedValue(undefined);
    const onDone = vi.fn();
    const { stdin, lastFrame } = render(<Screen onDone={onDone} />);
    await flush();
    stdin.write(ENTER);
    stdin.write('q');
    await flush();

    expect(plain(lastFrame())).toContain('Loading…');
    expect(write).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('toggles and saves on enter', async () => {
    const { stdin, lastFrame } = await renderScreen(true);
    stdin.write(ENTER);
    await flush();

    expect(write).toHaveBeenCalledExactlyOnceWith({ enabled: false });
    expect(plain(lastFrame())).toContain(`${label} Off`);
  });

  it('toggles and saves on space, and back again on a second press', async () => {
    const { stdin, lastFrame } = await renderScreen(false);
    stdin.write(' ');
    await flush();
    expect(write).toHaveBeenLastCalledWith({ enabled: true });
    expect(plain(lastFrame())).toContain(`${label} On`);

    stdin.write(' ');
    await flush();
    expect(write).toHaveBeenLastCalledWith({ enabled: false });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('goes back on escape and on q, without saving', async () => {
    const { stdin, onDone } = await renderScreen(true);
    stdin.write(ESC);
    await flush();
    stdin.write('q');
    await flush();

    expect(onDone).toHaveBeenCalledTimes(2);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('OptInAnalyticsScreen', () => {
  it('explains what is shared and what never is', async () => {
    stores.readAnalyticsSetting.mockResolvedValue({ enabled: true });
    const { lastFrame } = render(<OptInAnalyticsScreen onDone={vi.fn()} />);
    await flush();

    const frame = plain(lastFrame());
    expect(frame).toContain('Shares which CLI commands are used and where imports succeed or fail.');
    expect(frame).toContain('Never includes source code, file paths, credentials, or authored content.');
  });
});
