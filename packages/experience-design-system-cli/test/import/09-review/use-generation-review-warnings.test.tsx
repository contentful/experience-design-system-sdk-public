import React from 'react';
import { Text } from 'ink';
import { cleanup, render } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshGeneratedReviewWarnings } from '@contentful/experience-design-system-backend-pipeline';
import { useGenerationReviewWarnings } from '../../../src/tui/import/steps/09-review/use-generation-review-warnings.js';

vi.mock('@contentful/experience-design-system-backend-pipeline', () => ({ refreshGeneratedReviewWarnings: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const components = [
  {
    key: 'Button',
    entry: { $type: 'component' as const, $properties: {} },
    status: 'needs-review' as const,
    generationError: 'Unknown slot',
  },
];

class Boundary extends React.Component<React.PropsWithChildren, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  render() {
    return this.state.crashed ? <Text>crashed</Text> : this.props.children;
  }
}

describe('review warning refresh', () => {
  it('keeps review usable and preserves the proposal when validation unexpectedly fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(refreshGeneratedReviewWarnings).mockImplementation(() => {
      throw new Error('database failure');
    });
    const setComponents = vi.fn();
    function Probe() {
      const error = useGenerationReviewWarnings('session', components, setComponents, false, null);
      return <Text>{error ?? 'editable'}</Text>;
    }
    const view = render(
      <Boundary>
        <Probe />
      </Boundary>,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(view.lastFrame()).toContain('Warning validation is unavailable');
    expect(view.lastFrame()).not.toContain('database failure');
    expect(setComponents).not.toHaveBeenCalled();
  });

  it('refreshes resolved warnings and skips validation while loading', async () => {
    const setComponents = vi.fn();
    const repaired = components.map((component) => ({ ...component, generationError: undefined }));
    vi.mocked(refreshGeneratedReviewWarnings).mockReturnValue(repaired);
    function Probe({ loading }: { loading: boolean }) {
      useGenerationReviewWarnings('session', components, setComponents, loading, null);
      return <Text>editable</Text>;
    }
    const view = render(<Probe loading />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(refreshGeneratedReviewWarnings).not.toHaveBeenCalled();
    view.rerender(<Probe loading={false} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(setComponents).toHaveBeenCalledWith(repaired);
  });
});
