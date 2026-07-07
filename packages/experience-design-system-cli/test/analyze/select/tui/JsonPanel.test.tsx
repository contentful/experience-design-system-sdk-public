import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { JsonPanel } from '../../../../src/analyze/select/tui/components/JsonPanel.js';

function makeLines(n: number): string {
  return Array.from({ length: n }, (_, i) => `"line${i}": ${i}`).join('\n');
}

describe('JsonPanel scroll indicator', () => {
  it('does not render the scroll indicator when content fits in the panel', () => {
    const value = makeLines(5);
    const { lastFrame } = render(
      <JsonPanel label="JSON" value={value} scrollOffset={0} width={40} height={10} active={true} />,
    );
    expect(lastFrame() ?? '').not.toContain('↕');
  });

  it('renders the scroll indicator when content overflows at offset 0', () => {
    const value = makeLines(20);
    const { lastFrame } = render(
      <JsonPanel label="JSON" value={value} scrollOffset={0} width={40} height={5} active={true} />,
    );
    expect(lastFrame() ?? '').toContain('↕ 1-5/20');
  });

  it('updates the indicator to reflect the current scroll offset', () => {
    const value = makeLines(20);
    const { lastFrame } = render(
      <JsonPanel label="JSON" value={value} scrollOffset={10} width={40} height={5} active={true} />,
    );
    expect(lastFrame() ?? '').toContain('↕ 11-15/20');
  });
});
