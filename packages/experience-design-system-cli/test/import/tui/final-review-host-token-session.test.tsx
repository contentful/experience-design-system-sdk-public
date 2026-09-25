import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { FinalReviewHost } from '../../../src/import/tui/final-review-host.js';

vi.mock('../../../src/import/tui/steps/GenerateReviewStep.js', () => ({
  GenerateReviewStep: (props: { tokenSessionId?: string | null }) => <Text>{props.tokenSessionId}</Text>,
}));

describe('FinalReviewHost — token catalog session', () => {
  it('forwards tokenSessionId to the composite review step', () => {
    const commonProps = {
      extractSessionId: 'extract-session',
      tokenSessionId: 'token-session',
      onFinalize: vi.fn(),
      onQuit: vi.fn(),
    };

    expect(render(<FinalReviewHost {...commonProps} />).lastFrame()).toContain('token-session');
  });
});
