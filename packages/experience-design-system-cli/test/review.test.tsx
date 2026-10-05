import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import { SelectionReviewScreen } from '../src/tui/review/SelectionReviewScreen.js';
import type { SelectionReviewItem } from '@contentful/experience-design-system-agents';

const item: SelectionReviewItem = {
  id: 'd1',
  componentKey: 'Card::src/Card.tsx',
  field: 'decision',
  valuesByAgent: { 0: 'accepted', 1: 'rejected' },
  reasonsByAgent: { 0: 'visible UI', 1: 'wrapper' },
  tier: 'interpretive',
  tierReason: 'Requires judgment.',
  status: 'resolved',
  determination: {
    disagreementId: 'd1',
    decision: 'accepted',
    reason: 'Owns visible markup.',
    resolvedBy: 'debate',
  },
  debate: {
    disagreementId: 'd1',
    for: {
      role: 'for',
      disagreementId: 'd1',
      argument: 'Renders the authorable card UI.',
      evidence: [{ source: 'src/Card.tsx', line: '12', quote: '<Card />' }],
    },
    against: {
      role: 'against',
      disagreementId: 'd1',
      argument: 'Only forwards props.',
      evidence: [{ source: 'src/Card.tsx', line: '8', quote: 'return <Wrapper />' }],
    },
  },
};

describe('SelectionReviewScreen', () => {
  it('renders disagreement values, debate arguments, evidence, and determination', () => {
    const { lastFrame, unmount } = render(<SelectionReviewScreen items={[item]} onDone={vi.fn()} />);

    expect(lastFrame()).toContain('d1 · Card::src/Card.tsx · resolved');
    expect(lastFrame()).toContain('values: agent 0: "accepted" · agent 1: "rejected"');
    expect(lastFrame()).toContain('FOR: Renders the authorable card UI.');
    expect(lastFrame()).toContain('FOR evidence: src/Card.tsx:12 — <Card />');
    expect(lastFrame()).toContain('AGAINST: Only forwards props.');
    expect(lastFrame()).toContain('outcome: accepted via debate');

    unmount();
  });

  it('returns to the caller on Enter', async () => {
    const onDone = vi.fn();
    const { stdin, unmount } = render(<SelectionReviewScreen items={[]} onDone={onDone} />);

    await new Promise((resolve) => setTimeout(resolve, 10));
    stdin.write('\r');
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(onDone).toHaveBeenCalledTimes(1);
    unmount();
  });
});
