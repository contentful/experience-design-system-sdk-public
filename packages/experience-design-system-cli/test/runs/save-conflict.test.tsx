import { render } from 'ink-testing-library';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { waitForFrame } from '../helpers/wait-for-frame.js';
import { SaveConflictGate } from '../../src/runs/save-conflict.js';

afterEach(() => {
  vi.clearAllMocks();
});

function makeHandlers() {
  return {
    onOverwrite: vi.fn(),
    onNew: vi.fn(),
    onCancel: vi.fn(),
  };
}

describe('SaveConflictGate', () => {
  it('renders three options with cursor default on "new"', async () => {
    const handlers = makeHandlers();
    const { lastFrame } = render(<SaveConflictGate path="/work/foo/dist" {...handlers} />);
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('verwrite') && f.includes(']ew') && f.includes(']ancel'),
      3000,
    );
    expect(frame).toContain('/work/foo/dist');
    // Cursor default: "new" should be the focused option
    // Cursor default points at the "new" row.
    const lines = frame.split('\n');
    const focusedLine = lines.find((l) => l.includes('❯'));
    expect(focusedLine).toBeDefined();
    expect(focusedLine!).toContain('n]ew');
  });

  it('fires onOverwrite when o is pressed', async () => {
    const handlers = makeHandlers();
    const { stdin, lastFrame } = render(<SaveConflictGate path="/work/foo/dist" {...handlers} />);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('verwrite'),
      3000,
    );
    stdin.write('o');
    await new Promise((r) => setTimeout(r, 50));
    expect(handlers.onOverwrite).toHaveBeenCalled();
  });

  it('fires onNew when n is pressed', async () => {
    const handlers = makeHandlers();
    const { stdin, lastFrame } = render(<SaveConflictGate path="/work/foo/dist" {...handlers} />);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('verwrite'),
      3000,
    );
    stdin.write('n');
    await new Promise((r) => setTimeout(r, 50));
    expect(handlers.onNew).toHaveBeenCalled();
  });

  it('fires onCancel when c is pressed', async () => {
    const handlers = makeHandlers();
    const { stdin, lastFrame } = render(<SaveConflictGate path="/work/foo/dist" {...handlers} />);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('verwrite'),
      3000,
    );
    stdin.write('c');
    await new Promise((r) => setTimeout(r, 50));
    expect(handlers.onCancel).toHaveBeenCalled();
  });

  it('navigates with arrows and Enter triggers focused option', async () => {
    const handlers = makeHandlers();
    const { stdin, lastFrame } = render(<SaveConflictGate path="/work/foo/dist" {...handlers} />);
    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('verwrite'),
      3000,
    );
    // Default focus is "new" — move up to "overwrite"
    stdin.write('\x1b[A');
    await new Promise((r) => setTimeout(r, 30));
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 50));
    expect(handlers.onOverwrite).toHaveBeenCalled();
  });
});
