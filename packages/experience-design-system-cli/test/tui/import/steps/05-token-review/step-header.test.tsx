import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { HiddenStepsContext, StepHeader } from '../../../../../src/tui/shared/components/StepHeader.js';

describe('StepHeader', () => {
  it('shows every step by default', () => {
    const { lastFrame } = render(<StepHeader step="setup" />);
    for (const label of ['Setup', 'Extract', 'Select', 'Generate', 'Review', 'Push']) {
      expect(lastFrame()).toContain(label);
    }
  });

  it('leaves out hidden steps', () => {
    const { lastFrame } = render(
      <HiddenStepsContext.Provider value={['extraction', 'scope-gate']}>
        <StepHeader step="review" />
      </HiddenStepsContext.Provider>,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Setup');
    expect(frame).toContain('Generate');
    expect(frame).toContain('Review');
    expect(frame).toContain('Push');
    for (const label of ['Extract', 'Select']) expect(frame).not.toContain(label);
  });
});
