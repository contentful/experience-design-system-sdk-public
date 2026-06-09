import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { Sidebar } from '../../../../src/analyze/select/tui/components/Sidebar.js';
import type { ReviewComponentSummary } from '../../../../src/analyze/select/types.js';

const components: ReviewComponentSummary[] = [
  { id: 'a', name: 'Button', status: 'accepted', extractionConfidence: 95, needsReview: false },
  { id: 'b', name: 'Card', status: 'rejected', extractionConfidence: 90, needsReview: false },
  { id: 'c', name: 'Input', status: 'needs-review', extractionConfidence: 60, needsReview: true },
  { id: 'd', name: 'Select', status: 'reviewed', extractionConfidence: 80, needsReview: false },
];

describe('Sidebar', () => {
  it('renders correct status symbols', () => {
    const { lastFrame } = render(
      <Sidebar components={components} selectedId="a" focused={false} scrollOffset={0} visibleCount={10} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✓');
    expect(frame).toContain('✗');
    expect(frame).toContain('·');
    expect(frame).toContain('~');
  });

  it('truncates names that exceed maxNameLen (width 18 - 4 = 14 chars)', () => {
    const longComponents: ReviewComponentSummary[] = [
      { id: 'x', name: 'VeryLongComponentName', status: 'needs-review', extractionConfidence: 50, needsReview: true },
    ];
    const { lastFrame } = render(
      <Sidebar components={longComponents} selectedId={null} focused={false} scrollOffset={0} visibleCount={10} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain('VeryLongComponentName ');
    expect(frame).toContain('…');
  });

  it('shows scroll indicators when content overflows', () => {
    const manyComponents: ReviewComponentSummary[] = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      name: `Comp${i}`,
      status: 'needs-review' as const,
      extractionConfidence: 50,
      needsReview: true,
    }));
    const { lastFrame } = render(
      <Sidebar components={manyComponents} selectedId="0" focused={false} scrollOffset={1} visibleCount={5} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('▲');
    expect(frame).toContain('▼');
  });

  it('renders component names without confidence scores (scores are in detail header)', () => {
    const mixed: ReviewComponentSummary[] = [
      { id: '1', name: 'Good', status: 'needs-review', extractionConfidence: 95, needsReview: false },
      { id: '2', name: 'Medium', status: 'needs-review', extractionConfidence: 65, needsReview: false },
      { id: '3', name: 'Flagged', status: 'needs-review', extractionConfidence: 40, needsReview: true },
    ];
    const { lastFrame } = render(
      <Sidebar components={mixed} selectedId={null} focused={false} scrollOffset={0} visibleCount={10} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Good');
    expect(frame).toContain('Medium');
    expect(frame).toContain('Flagged');
  });
});
