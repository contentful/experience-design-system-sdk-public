import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ReviewGenerationWarning } from '../../../src/tui/import/steps/09-review/components/ReviewComponentPanel.js';

afterEach(cleanup);

describe('generation warnings in review', () => {
  it('removes the banner after repair and restores it when an invalid proposal is restored', () => {
    const selected = {
      key: 'Button',
      entry: { $type: 'component' as const, $properties: {} },
      status: 'needs-review' as const,
      generationError: 'Unknown slot',
    };
    const view = render(<ReviewGenerationWarning count={1} hidden={false} selected={selected} />);
    view.rerender(
      <ReviewGenerationWarning count={0} hidden={false} selected={{ ...selected, generationError: undefined }} />,
    );
    expect(view.lastFrame()).not.toContain('Generation needs attention');
    view.rerender(<ReviewGenerationWarning count={1} hidden={false} selected={selected} />);
    expect(view.lastFrame()).toContain('Generation needs attention');
  });
  it('shows the warning count and the selected component error', () => {
    const view = render(
      <ReviewGenerationWarning
        count={1}
        hidden={false}
        selected={{
          key: 'Button',
          entry: { $type: 'component', $properties: {} },
          status: 'needs-review',
          generationError: 'Unknown slot',
        }}
      />,
    );
    expect(view.lastFrame()).toContain('Generation needs attention');
    expect(view.lastFrame()).toContain('1 component');
    expect(view.lastFrame()).toContain('Button: Unknown slot');
    expect(view.lastFrame()?.split('\n')).toHaveLength(2);
  });

  it.each([
    { count: 0, hidden: false },
    { count: 1, hidden: true },
  ])('does not show a banner when warnings are absent or a dialog is open: %j', (props) => {
    const view = render(<ReviewGenerationWarning {...props} selected={null} />);
    expect(view.lastFrame()).not.toContain('Generation needs attention');
  });
});
