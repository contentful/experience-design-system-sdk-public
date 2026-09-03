import { describe, expect, it, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { FinalReviewHost } from '../../../src/import/tui/final-review-host.js';

vi.mock('../../../src/import/tui/steps/AtomicGenerateReviewStep.js', () => ({
  AtomicGenerateReviewStep: (props: { tokenSessionId?: string | null }) => <Text>{props.tokenSessionId}</Text>,
}));

vi.mock('../../../src/import/tui/steps/GenerateReviewStep.js', () => ({
  GenerateReviewStep: (props: { tokenSessionId?: string | null }) => <Text>{props.tokenSessionId}</Text>,
}));

describe('FinalReviewHost — token catalog session', () => {
  it('forwards tokenSessionId to both review step variants', () => {
    const commonProps = {
      extractSessionId: 'extract-session',
      tokenSessionId: 'token-session',
      generatedCount: 1,
      autoAccept: false,
      onFinalize: vi.fn(),
      onQuit: vi.fn(),
    };

    expect(render(<FinalReviewHost {...commonProps} compositionMode="atomic" />).lastFrame()).toContain(
      'token-session',
    );
    expect(render(<FinalReviewHost {...commonProps} compositionMode="composite" />).lastFrame()).toContain(
      'token-session',
    );
  });
});
