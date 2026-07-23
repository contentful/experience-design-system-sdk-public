import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { RunningStep } from '../../../../src/import/tui/steps/RunningStep.js';

describe('RunningStep', () => {
  const base = { stepNumber: 1, totalSteps: 3, title: 'Extracting components', description: 'desc' };

  it('renders the primary detail line', () => {
    const { lastFrame } = render(<RunningStep {...base} detail="Scanned 42 files..." />);
    expect(lastFrame() ?? '').toContain('Scanned 42 files...');
  });

  it('renders a secondary detail line when provided', () => {
    const { lastFrame } = render(
      <RunningStep
        {...base}
        detail="Analyzing 10/20 files"
        secondaryDetail="Resolving composition via claude agent..."
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Analyzing 10/20 files');
    expect(frame).toContain('Resolving composition via claude agent...');
  });

  it('omits the secondary line when not provided', () => {
    const { lastFrame } = render(<RunningStep {...base} detail="Scanning..." />);
    expect(lastFrame() ?? '').not.toContain('composition');
  });
});
