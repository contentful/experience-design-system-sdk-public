import { describe, expect, it } from 'vitest';
import { getReviewJsonPanelValue } from '../../../../src/import/tui/steps/review-json-panel.js';

describe('getReviewJsonPanelValue', () => {
  const selected = {
    key: 'Button',
    entry: {
      $type: 'component' as const,
      $properties: {
        label: { $type: 'string' as const, $category: 'content' as const },
        isDisabled: { $type: 'boolean' as const, $category: 'state' as const },
        className: { $type: 'string' as const, $category: 'unattached' as const },
      },
    },
  };

  it('hides state and unattached properties unless requested', () => {
    expect(getReviewJsonPanelValue(selected, false)).not.toContain('isDisabled');
    expect(getReviewJsonPanelValue(selected, false)).not.toContain('className');
    expect(getReviewJsonPanelValue(selected, true)).toContain('isDisabled');
    expect(getReviewJsonPanelValue(selected, true)).toContain('className');
  });
});
