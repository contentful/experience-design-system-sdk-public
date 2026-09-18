import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { countReviewStatuses, ReviewStatusBar } from '../../../../src/import/tui/components/ReviewStatus.js';

describe('countReviewStatuses', () => {
  it('counts actionable statuses and ignores reviewed entries', () => {
    expect(
      countReviewStatuses([
        { status: 'accepted' },
        { status: 'rejected' },
        { status: 'needs-review' },
        { status: 'reviewed' },
        { status: 'accepted' },
      ]),
    ).toEqual({ accepted: 2, rejected: 1, needsReview: 1 });
  });

  it('returns zero counts for an empty review', () => {
    expect(countReviewStatuses([])).toEqual({ accepted: 0, rejected: 0, needsReview: 0 });
  });

  it('renders the same counts through the shared status bar', () => {
    const { lastFrame } = render(
      React.createElement(ReviewStatusBar, {
        entries: [{ status: 'accepted' }, { status: 'rejected' }, { status: 'needs-review' }],
        onApproveAll: () => {},
        onFinalize: () => {},
      }),
    );

    expect(lastFrame() ?? '').toContain('1 accepted');
    expect(lastFrame() ?? '').toContain('1 rejected');
    expect(lastFrame() ?? '').toContain('1 pending');
  });
});
