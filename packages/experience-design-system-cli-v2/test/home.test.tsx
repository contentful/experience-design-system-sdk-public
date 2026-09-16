import { readFileSync } from 'node:fs';
import { render } from 'ink-testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MIN_COLUMNS, StartScreen } from '../start.js';
import { BRAND, FOCUS_MARKER, PALETTE } from '../src/tui/theme.js';

const ESC = '\u001B';
const ARROW_UP = `${ESC}[A`;
const ARROW_DOWN = `${ESC}[B`;
const ENTER = '\r';

const LABELS = ['Import', 'Saved Runs', 'Upgrade Version', 'Settings', 'Help'];

const exit = vi.hoisted(() => vi.fn());

/**
 * Terminal width the component sees; stubbed so tests do not depend on the
 * runner's. `beforeEach` resets it relative to MIN_COLUMNS before every test —
 * this initial value only has to exist, since vi.hoisted runs before imports.
 */
const terminalWidth = vi.hoisted(() => ({ current: 0 }));

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return { ...actual, useApp: () => ({ exit }) };
});

vi.mock('../src/tui/use-terminal-width.js', () => ({
  useTerminalWidth: () => terminalWidth.current,
}));

beforeEach(() => {
  // Comfortably above the gate, so tests exercise the full page by default.
  terminalWidth.current = MIN_COLUMNS + 20;
  exit.mockClear();
});

/** ink renders asynchronously; give it a tick to flush before asserting. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

function renderHome() {
  const onNavigate = vi.fn();
  const instance = render(<StartScreen onNavigate={onNavigate} />);
  return { ...instance, onNavigate };
}

/** Strip ANSI escapes so assertions read only the visible characters. */
function plain(frame: string): string {
  return frame.replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '');
}

/** Truecolor foreground escape ink emits for a hex color. */
function fgEscape(hex: string): string {
  const int = parseInt(hex.slice(1), 16);
  return `${ESC}[38;2;${(int >> 16) & 0xff};${(int >> 8) & 0xff};${int & 0xff}m`;
}

/** The label the focus marker currently sits against. */
function focusedLabel(frame: string): string | undefined {
  const line = plain(frame)
    .split('\n')
    .find((l) => l.includes(FOCUS_MARKER));
  if (!line) return undefined;
  return line.slice(line.indexOf(FOCUS_MARKER) + FOCUS_MARKER.length).trim();
}

describe('StartScreen', () => {
  it('renders every menu item', async () => {
    const { lastFrame } = renderHome();
    await flush();

    for (const label of LABELS) {
      expect(plain(lastFrame()!)).toContain(label);
    }
  });

  it('has no Exit row, since q quits', async () => {
    const { lastFrame } = renderHome();
    await flush();

    expect(plain(lastFrame()!)).not.toContain('Exit');
    expect(plain(lastFrame()!)).toContain('q quit');
  });

  it('renders the branded header and key hints', async () => {
    const { lastFrame } = renderHome();
    await flush();

    const frame = plain(lastFrame()!);
    expect(frame).toContain('Contentful Experiences');
    expect(frame).toContain("Let's import your design system into Contentful");
    expect(frame).toContain('q quit');
  });

  it('underlines the heading with a bar in all three brand colors', async () => {
    const { lastFrame } = renderHome();
    await flush();

    for (const color of [BRAND.blue, BRAND.orange, BRAND.yellow]) {
      expect(lastFrame()).toContain(fgEscape(color));
    }
    // The bar spans the heading exactly, split across three colored segments.
    const bar = plain(lastFrame()!)
      .split('\n')
      .find((l) => l.includes('━'));
    expect(bar?.match(/━/g)).toHaveLength('Contentful Experiences'.length);
  });

  it('shows the installed CLI version in the header', async () => {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    const { lastFrame } = renderHome();
    await flush();

    expect(plain(lastFrame()!)).toContain(`v${version}`);
  });

  it('paints the heading white and the focused row in the Contentful accent', async () => {
    const { lastFrame } = renderHome();
    await flush();

    expect(PALETTE.heading).toBe('#FFFFFF');
    expect(PALETTE.accent).toBe('#1773EB');
    expect(lastFrame()).toContain(fgEscape(PALETTE.heading));
    expect(lastFrame()).toContain(fgEscape(PALETTE.accent));
    expect(lastFrame()).toContain(fgEscape(PALETTE.muted));
  });

  it('focuses the first item on mount', async () => {
    const { lastFrame } = renderHome();
    await flush();

    expect(focusedLabel(lastFrame()!)).toBe('Import');
  });

  it('moves focus down with the down arrow', async () => {
    const { stdin, lastFrame } = renderHome();
    await flush();

    stdin.write(ARROW_DOWN);
    await flush();

    expect(focusedLabel(lastFrame()!)).toBe('Saved Runs');
  });

  it('wraps from the first item to the last when moving up', async () => {
    const { stdin, lastFrame } = renderHome();
    await flush();

    stdin.write(ARROW_UP);
    await flush();

    expect(focusedLabel(lastFrame()!)).toBe('Help');
  });

  it('wraps from the last item back to the first when moving down', async () => {
    const { stdin, lastFrame } = renderHome();
    await flush();

    stdin.write(ARROW_UP);
    await flush();
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

  it('navigates on Enter from the last item, which is no longer an exit row', async () => {
    const { stdin, onNavigate } = renderHome();
    await flush();

    stdin.write(ARROW_UP);
    await flush();
    stdin.write(ENTER);
    await flush();

    expect(onNavigate).toHaveBeenCalledWith('help');
    expect(exit).not.toHaveBeenCalled();
  });

  it('exits on q', async () => {
    const { stdin } = renderHome();
    await flush();

    stdin.write('q');
    await flush();

    expect(exit).toHaveBeenCalled();
  });

  describe('when the terminal is too narrow', () => {
    it('shows a notice instead of the menu', async () => {
      terminalWidth.current = MIN_COLUMNS - 1;
      const { lastFrame } = renderHome();
      await flush();

      const frame = plain(lastFrame()!);
      expect(frame).toContain('Terminal too small');
      expect(frame).toContain('Use full screen');
      expect(frame).toContain('for the best experience');
      expect(frame).not.toContain('Saved Runs');
    });

    it('renders the full menu at exactly the minimum width', async () => {
      terminalWidth.current = MIN_COLUMNS;
      const { lastFrame } = renderHome();
      await flush();

      const frame = plain(lastFrame()!);
      expect(frame).not.toContain('Terminal too small');
      expect(frame).toContain('Saved Runs');
    });

    it('still exits on q', async () => {
      terminalWidth.current = MIN_COLUMNS - 1;
      const { stdin } = renderHome();
      await flush();

      stdin.write('q');
      await flush();

      expect(exit).toHaveBeenCalled();
    });

    it('does not navigate on Enter', async () => {
      terminalWidth.current = MIN_COLUMNS - 1;
      const { stdin, onNavigate } = renderHome();
      await flush();

      stdin.write(ENTER);
      await flush();

      expect(onNavigate).not.toHaveBeenCalled();
    });
  });
});
