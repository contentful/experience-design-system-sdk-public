import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { StatusBar } from '../../../../src/analyze/select/tui/components/StatusBar.js';

describe('StatusBar', () => {
  it('renders correct component counts', () => {
    const { lastFrame } = render(
      <StatusBar accepted={3} rejected={1} reviewed={2} needsReview={4} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('3 accepted');
    expect(frame).toContain('1 rejected');
    expect(frame).toContain('2 reviewed');
    expect(frame).toContain('4 pending');
  });

  it('shows [F] fin hint', () => {
    const { lastFrame } = render(
      <StatusBar accepted={3} rejected={1} reviewed={0} needsReview={2} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[F]');
  });

  it('shows [A] all hint', () => {
    const { lastFrame } = render(
      <StatusBar accepted={0} rejected={0} reviewed={0} needsReview={5} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('[A]');
  });
});
