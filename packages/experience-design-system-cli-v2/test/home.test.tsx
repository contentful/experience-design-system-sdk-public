import { render } from 'ink-testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_TERMINAL_WIDTH, StartScreen } from '../start.js';
import { BRAND, FOCUS_MARKER } from '../src/tui/styles/theme.js';

const ESC = '\u001B';
const ARROW_UP = `${ESC}[A`;
const ARROW_DOWN = `${ESC}[B`;
const ENTER = '\r';

const LABELS = ['Import', 'Saved Runs', 'Upgrade Version', 'Settings', 'Help'];

const exit = vi.hoisted(() => vi.fn());
const terminalWidth = vi.hoisted(() => ({ current: 0 }));

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return { ...actual, useApp: () => ({ exit }) };
});

vi.mock('../src/tui/use-terminal-width.js', () => ({
  useTerminalWidth: () => terminalWidth.current,
}));

beforeEach(() => {
  terminalWidth.current = MIN_TERMINAL_WIDTH + 20;
  exit.mockClear();
});

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function renderHome() {
  const onNavigate = vi.fn();
  const instance = render(<StartScreen onNavigate={onNavigate} />);
  return { ...instance, onNavigate };
}

function plain(frame: string): string {
  return frame.replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
}

function fgEscape(hex: string): string {
  const int = parseInt(hex.slice(1), 16);
  return `${ESC}[38;2;${(int >> 16) & 0xff};${(int >> 8) & 0xff};${int & 0xff}m`;
}

function focusedLabel(frame: string): string | undefined {
  const line = plain(frame)
    .split('\n')
    .find((l) => l.includes(FOCUS_MARKER));
  if (!line) return undefined;
  return line.slice(line.indexOf(FOCUS_MARKER) + FOCUS_MARKER.length).trim();
}

describe('StartScreen', () => {
  it('renders the header and every menu item', async () => {
    const { lastFrame } = renderHome();
    await flush();

    const frame = plain(lastFrame()!);
    expect(frame).toContain('Contentful Experiences');
    expect(frame).toContain("Let's import your design system into Contentful");
    for (const label of LABELS) {
      expect(frame).toContain(label);
    }
  });

  it('underlines the heading with a bar in the three brand colors', async () => {
    const { lastFrame } = renderHome();
    await flush();

    for (const color of [BRAND.blue, BRAND.orange, BRAND.yellow]) {
      expect(lastFrame()).toContain(fgEscape(color));
    }
  });

  it('moves focus with the arrow keys, wrapping at both ends', async () => {
    const { stdin, lastFrame } = renderHome();
    await flush();
    expect(focusedLabel(lastFrame()!)).toBe('Import');

    stdin.write(ARROW_DOWN);
    await flush();
    expect(focusedLabel(lastFrame()!)).toBe('Saved Runs');

    stdin.write(ARROW_UP);
    await flush();
    stdin.write(ARROW_UP);
    await flush();
    expect(focusedLabel(lastFrame()!)).toBe('Help');

    stdin.write(ARROW_DOWN);
    await flush();
    expect(focusedLabel(lastFrame()!)).toBe('Import');
  });

  it('navigates to the focused screen on Enter', async () => {
    const { stdin, onNavigate } = renderHome();
    await flush();

    stdin.write(ARROW_DOWN);
    await flush();
    stdin.write(ENTER);
    await flush();

    expect(onNavigate).toHaveBeenCalledWith('saved-runs');
  });

  it('exits on q', async () => {
    const { stdin } = renderHome();
    await flush();

    stdin.write('q');
    await flush();

    expect(exit).toHaveBeenCalled();
  });

  describe('when the terminal is too narrow', () => {
    beforeEach(() => {
      terminalWidth.current = MIN_TERMINAL_WIDTH - 1;
    });

    it('shows a notice instead of the menu', async () => {
      const { lastFrame } = renderHome();
      await flush();

      const frame = plain(lastFrame()!);
      expect(frame).toContain('Terminal too small');
      expect(frame).not.toContain('Saved Runs');
    });

    it('renders the menu at exactly the minimum width', async () => {
      terminalWidth.current = MIN_TERMINAL_WIDTH;
      const { lastFrame } = renderHome();
      await flush();

      expect(plain(lastFrame()!)).toContain('Saved Runs');
    });

    it('quits on q but ignores Enter', async () => {
      const { stdin, onNavigate } = renderHome();
      await flush();

      stdin.write(ENTER);
      await flush();
      expect(onNavigate).not.toHaveBeenCalled();

      stdin.write('q');
      await flush();
      expect(exit).toHaveBeenCalled();
    });
  });
});
