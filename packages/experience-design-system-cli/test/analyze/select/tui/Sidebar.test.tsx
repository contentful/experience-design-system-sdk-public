import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';
import { Sidebar } from '../../../../src/analyze/select/tui/components/Sidebar.js';
import type { ReviewComponentSummary } from '../../../../src/analyze/select/types.js';

const components: ReviewComponentSummary[] = [
  { id: 'a', name: 'Button', status: 'accepted' },
  { id: 'b', name: 'Card', status: 'rejected' },
  { id: 'c', name: 'Input', status: 'needs-review' },
  { id: 'd', name: 'Select', status: 'reviewed' },
];

describe('Sidebar', () => {
  it('renders correct status symbols', () => {
    const { lastFrame } = render(
      <Sidebar
        components={components}
        selectedId="a"
        focused={false}
        scrollOffset={0}
        visibleCount={10}
        onSelect={vi.fn()}
        onScrollChange={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓');
    expect(frame).toContain('✗');
    expect(frame).toContain('·');
    expect(frame).toContain('~');
  });

  it('truncates names longer than 13 chars', () => {
    const longComponents: ReviewComponentSummary[] = [
      { id: 'x', name: 'VeryLongComponentName', status: 'needs-review' },
    ];
    const { lastFrame } = render(
      <Sidebar
        components={longComponents}
        selectedId={null}
        focused={false}
        scrollOffset={0}
        visibleCount={10}
        onSelect={vi.fn()}
        onScrollChange={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('VeryLongCompo…');
    expect(frame).not.toContain('VeryLongComponentName');
  });

  it('shows scroll indicators when content overflows', () => {
    const manyComponents: ReviewComponentSummary[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      name: `Comp${i}`,
      status: 'needs-review' as const,
    }));
    const { lastFrame } = render(
      <Sidebar
        components={manyComponents}
        selectedId="0"
        focused={false}
        scrollOffset={1}
        visibleCount={5}
        onSelect={vi.fn()}
        onScrollChange={vi.fn()}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('▲');
    expect(frame).toContain('▼');
  });
});
