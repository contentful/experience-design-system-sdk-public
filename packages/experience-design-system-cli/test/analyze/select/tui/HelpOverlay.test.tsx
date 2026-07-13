import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { HelpOverlay } from '../../../../src/analyze/select/tui/components/HelpOverlay.js';

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

describe('HelpOverlay', () => {
  it('renders navigation keys', () => {
    const { lastFrame } = render(<HelpOverlay mode="review" onClose={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Navigation');
    expect(frame).toContain('↑');
    expect(frame).toContain('↓');
  });

  it('renders review-mode keys when mode is review', () => {
    const { lastFrame } = render(<HelpOverlay mode="review" onClose={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Accept component');
    expect(frame).toContain('Reject component');
    expect(frame).toContain('Ctrl+S');
  });

  it('advertises both undo and redo in review mode (L3)', () => {
    const { lastFrame } = render(<HelpOverlay mode="review" onClose={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Ctrl+Z');
    expect(frame).toMatch(/Undo/i);
    expect(frame).toContain('Ctrl+Y');
    expect(frame).toMatch(/Redo/i);
  });

  it('does not render review keys when mode is analyze', () => {
    const { lastFrame } = render(<HelpOverlay mode="analyze" onClose={vi.fn()} />);
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('Accept component');
  });

  it('calls onClose when ? is pressed', async () => {
    const onClose = vi.fn();
    const { stdin } = render(<HelpOverlay mode="review" onClose={onClose} />);
    stdin.write('?');
    await new Promise((r) => setTimeout(r, 30));
    expect(onClose).toHaveBeenCalled();
  });

  it('matches snapshot in review mode', () => {
    const { lastFrame } = render(<HelpOverlay mode="review" onClose={vi.fn()} />);
    expect(stripAnsi(lastFrame() ?? '')).toMatchSnapshot();
  });
});
