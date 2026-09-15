import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { StartScreen } from '../start.js';
import { FOCUS_MARKER, PALETTE } from '../src/tui/theme.js';

const ESC = '\u001B';
const ARROW_UP = `${ESC}[A`;
const ARROW_DOWN = `${ESC}[B`;
const ENTER = '\r';

const LABELS = ['Import', 'Saved Runs', 'Upgrade', 'Settings', 'Help', 'Exit'];

const exit = vi.hoisted(() => vi.fn());

vi.mock('ink', async () => {
  const actual = await vi.importActual<typeof import('ink')>('ink');
  return { ...actual, useApp: () => ({ exit }) };
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
  const afterMarker = line.slice(line.indexOf(FOCUS_MARKER) + FOCUS_MARKER.length).trimStart();
  // Labels are padded to a common width and butt up against the hint column,
  // so match the known labels rather than splitting on whitespace.
  return LABELS.find((label) => afterMarker.startsWith(label));
}

describe('StartScreen', () => {
  it('renders every menu item', async () => {
    const { lastFrame } = renderHome();
    await flush();

    for (const label of LABELS) {
      expect(plain(lastFrame()!)).toContain(label);
    }
  });

  it('renders the branded header and key hints', async () => {
    const { lastFrame } = renderHome();
    await flush();

    const frame = plain(lastFrame()!);
    expect(frame).toContain('Contentful Experiences');
    expect(frame).toContain('Design System Import');
    expect(frame).toContain('q quit');
  });

  it('paints the wordmark and focused row in the Contentful accent color', async () => {
    const { lastFrame } = renderHome();
    await flush();

    expect(PALETTE.accent).toBe('#1773EB');
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

    expect(focusedLabel(lastFrame()!)).toBe('Exit');
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

  it('exits instead of navigating when Exit is selected', async () => {
    exit.mockClear();
    const { stdin, onNavigate } = renderHome();
    await flush();

    stdin.write(ARROW_UP);
    await flush();
    stdin.write(ENTER);
    await flush();

    expect(exit).toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('exits on q', async () => {
    exit.mockClear();
    const { stdin } = renderHome();
    await flush();

    stdin.write('q');
    await flush();

    expect(exit).toHaveBeenCalled();
  });
});
