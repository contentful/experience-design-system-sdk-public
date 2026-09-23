import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { ErrorStep } from '../../../src/import/tui/steps/ErrorStep.js';

describe('ErrorStep', () => {
  it('offers breaking-change acknowledgment and retries when Enter is pressed', () => {
    const onAcknowledge = vi.fn();
    const { lastFrame, stdin } = render(
      <ErrorStep
        stepName="apply push"
        message="Apply contains breaking Component changes affecting 1 Fragment(s). Set acknowledgeBreakingChanges: true to proceed."
        onExit={() => {}}
        onAcknowledgeBreakingChanges={onAcknowledge}
      />,
    );

    expect(lastFrame()).toContain('Acknowledge and apply');
    expect(lastFrame()).toContain('[Esc / q] Exit');
    stdin.write('\r');
    expect(onAcknowledge).toHaveBeenCalledOnce();
  });

  it('does not show the acknowledgment action for ordinary errors', () => {
    const { lastFrame } = render(<ErrorStep stepName="apply push" message="Unexpected failure" onExit={() => {}} />);

    expect(lastFrame()).not.toContain('Acknowledge and apply');
  });
});
