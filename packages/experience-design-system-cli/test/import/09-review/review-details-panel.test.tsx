import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import type { ComponentReviewMetadata } from '@contentful/experience-design-system-backend-pipeline';
import { ReviewDetailsPanel } from '../../../src/tui/import/steps/09-review/review-details-panel.js';

describe('review source panel evidence viewport', () => {
  it.each([0, 100])('keeps source and close action visible with %s candidates', (count) => {
    const metadata = {
      sourcePath: 'Card.tsx',
      componentSource: 'VISIBLE_SOURCE_LINE',
      sourceEvidenceReadStatus: 'available',
      sourceCandidates: Array.from({ length: count }, (_, index) => ({
        name: `field${index}`,
        type: 'string',
        facts: null,
        projection: { kind: 'prop', reason: null },
      })),
      extractionDiagnostics: { status: 'absent' },
    } as ComponentReviewMetadata;
    const view = render(
      <ReviewDetailsPanel
        selectedKey="Card"
        panelOpen="source"
        componentRationale={null}
        reviewMetadata={metadata}
        panelScrollOffset={0}
        width={100}
        height={14}
        tokenSuggestions={[]}
        tokenReviewRow={0}
        tokenReviewEditing={false}
        tokenReviewEditCursor={0}
        tokenReviewEditSelection={new Set()}
        showJson={false}
        jsonValue=""
        jsonScrollOffset={0}
        sidebarFocused={false}
        editor={null}
      />,
    );
    try {
      expect(view.lastFrame()).toContain('VISIBLE_SOURCE_LINE');
      expect(view.lastFrame()).toContain('[s/Esc] close');
    } finally {
      view.unmount();
    }
  });
});
