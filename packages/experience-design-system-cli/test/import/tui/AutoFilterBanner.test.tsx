import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { AutoFilterBanner } from '../../../src/import/tui/components/AutoFilterBanner.js';

describe('AutoFilterBanner', () => {
  it('renders the running header with progress', () => {
    const { lastFrame } = render(
      <AutoFilterBanner status="running" progress={{ done: 2, total: 5 }} error={null} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('AI filtering');
    expect(frame).toContain('2/5');
    expect(frame).toContain('[q] cancels');
  });

  it('does not render a running header when total is 0', () => {
    const { lastFrame } = render(
      <AutoFilterBanner status="running" progress={{ done: 0, total: 0 }} error={null} />,
    );
    expect(lastFrame() ?? '').not.toContain('AI filtering');
  });

  it('renders the cancelled banner with progress', () => {
    const { lastFrame } = render(
      <AutoFilterBanner status="cancelled" progress={{ done: 3, total: 8 }} error={null} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('AI auto-filter cancelled');
    expect(frame).toContain('at 3/8');
  });

  it('renders the failed banner with the error text', () => {
    const { lastFrame } = render(
      <AutoFilterBanner status="failed" progress={null} error="boom" />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('AI auto-filter failed');
    expect(frame).toContain('boom');
  });

  it('renders nothing for idle/complete', () => {
    const { lastFrame } = render(<AutoFilterBanner status="complete" progress={null} error={null} />);
    expect((lastFrame() ?? '').trim()).toBe('');
  });
});
