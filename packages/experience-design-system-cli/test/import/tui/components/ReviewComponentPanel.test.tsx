import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { ReviewComponentPanel } from '../../../../src/import/tui/components/ReviewComponentPanel.js';

vi.mock('../../../../src/import/tui/components/ReviewDetailsEditor.js', () => ({
  ReviewDetailsEditor: ({ selectedKey }: { selectedKey: string }) => <Text>{`editor:${selectedKey}`}</Text>,
}));

const REVIEW_EDITOR = {
  panelOpen: 'none' as const,
  panelScrollOffset: 0,
  tokenReviewRow: 0,
  tokenReviewEditing: false,
  tokenReviewEditCursor: 0,
  tokenReviewEditSelection: new Set<string>(),
  showJson: false,
  jsonScrollOffset: 0,
  currentTokenSuggestions: () => [],
};

describe('ReviewComponentPanel', () => {
  it('renders the selected component summary, editor, save error, and footer', () => {
    const { lastFrame } = render(
      <ReviewComponentPanel
        selectedKey="Button"
        selectedEntry={{
          $type: 'component',
          $properties: {
            one: { $type: 'string', $category: 'content' },
            two: { $type: 'string', $category: 'content' },
            three: { $type: 'string', $category: 'content' },
          },
          $slots: { content: { $allowedComponents: [] } },
        }}
        componentRationale={null}
        reviewMetadata={null}
        reviewEditor={REVIEW_EDITOR}
        width={60}
        height={22}
        jsonValue="{}"
        sidebarFocused
        fieldEditor={{
          value: '{}',
          onChange: () => {},
          onSave: () => {},
          onDiscard: () => {},
        }}
        saveError="Invalid CDF"
        sidebarFooter="[F] finalize"
        livePreview={{ status: 'idle', disabled: false }}
        livePreviewSpinner=""
      />,
    );
    const frame = lastFrame() ?? '';

    expect(frame).toContain('Button');
    expect(frame).toContain('3 props');
    expect(frame).toContain('1 slot');
    expect(frame).toContain('editor:Button');
    expect(frame).toContain('Invalid CDF');
    expect(frame).toContain('[F] finalize');
  });
});
