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
    expect(frame).toContain('Ctrl+S');
  });

  it('does not render review keys when mode is analyze', () => {
    const { lastFrame } = render(<HelpOverlay mode="analyze" onClose={vi.fn()} />);
    expect(lastFrame()).not.toContain('Accept component');
  });

  it('matches snapshot in review mode', () => {
    const { lastFrame } = render(<HelpOverlay mode="review" onClose={vi.fn()} />);
    expect(stripAnsi(lastFrame() ?? '')).toMatchSnapshot();
  });
});
