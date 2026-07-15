import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { CounterStrip } from '../../../src/import/tui/components/CounterStrip.js';

const counters = { accepted: 3, rejected: 1, undecided: 2, groups: 4, total: 6 };

describe('CounterStrip', () => {
  it('renders full labels at wide widths', () => {
    const { lastFrame } = render(<CounterStrip counters={counters} totalWidth={120} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Accepted');
    expect(frame).toContain('Groups');
    expect(frame).toContain('Rejected');
    expect(frame).toContain('Undecided');
    expect(frame).toContain('3');
    expect(frame).toContain('/6');
  });

  it('condenses labels at narrow widths', () => {
    const { lastFrame } = render(<CounterStrip counters={counters} totalWidth={40} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Acc');
    expect(frame).toContain('Grp');
    expect(frame).not.toContain('Accepted');
  });
});
