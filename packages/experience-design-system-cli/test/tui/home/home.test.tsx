import { render } from 'ink-testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const terminal = vi.hoisted(() => ({ width: 100 }));
vi.mock('../../../src/tui/use-terminal-width.js', () => ({ useTerminalWidth: () => terminal.width }));
// The upgrade check calls the npm registry; the home screen does not depend on its result.
vi.mock('../../../src/tui/home/version.js', () => ({
  readPackageVersion: () => '0.0.0',
  checkForUpgrade: () => new Promise(() => undefined),
}));

import { HomeScreen, MIN_TERMINAL_WIDTH } from '../../../src/tui/home/home.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

describe('HomeScreen terminal width', () => {
  beforeEach(() => {
    terminal.width = 100;
  });

  it('only needs a standard 80 column terminal', () => {
    expect(MIN_TERMINAL_WIDTH).toBe(80);
  });

  it.each([80, 100, 120])('shows the menu at %i columns', (width) => {
    terminal.width = width;
    const { lastFrame } = render(<HomeScreen onNavigate={vi.fn()} />);
    expect(lastFrame()).toContain('Import');
    expect(lastFrame()).toContain('Settings');
    expect(lastFrame()).not.toContain('Terminal too small');
  });

  it('says how wide the terminal needs to be when it is too narrow', () => {
    terminal.width = 79;
    const { lastFrame } = render(<HomeScreen onNavigate={vi.fn()} />);
    expect(lastFrame()).toContain('Terminal too small');
    expect(lastFrame()).toContain('at least 80 columns');
    expect(lastFrame()).toContain('79');
    expect(lastFrame()).not.toContain('Settings');
  });

  it('does not open a screen from the keyboard while too narrow', async () => {
    terminal.width = 60;
    const onNavigate = vi.fn();
    const { stdin } = render(<HomeScreen onNavigate={onNavigate} />);
    await tick();
    stdin.write('\r');
    await tick();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('opens the focused screen on Enter when wide enough', async () => {
    const onNavigate = vi.fn();
    const { stdin } = render(<HomeScreen onNavigate={onNavigate} />);
    await tick();
    stdin.write('\r');
    await tick();
    expect(onNavigate).toHaveBeenCalledWith('import');
  });
});
