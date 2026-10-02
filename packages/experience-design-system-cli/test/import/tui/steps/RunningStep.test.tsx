import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import { RunningStep } from '../../../../src/import/tui/steps/RunningStep.js';

describe('RunningStep', () => {
  const base = { stepNumber: 1, totalSteps: 3, title: 'Extracting components', description: 'desc' };

  it('renders the primary detail line', () => {
    const { lastFrame } = render(<RunningStep {...base} detail="Scanning 42 files" />);
    expect(lastFrame() ?? '').toContain('Scanning 42 files');
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

  it('renders a tertiary detail line when provided', () => {
    const { lastFrame } = render(
      <RunningStep {...base} detail="Analyzing 10/20 files" tertiaryDetail="Selection agent running..." />,
    );
    expect(lastFrame() ?? '').toContain('Selection agent running...');
  });

  it('renders a quaternary detail line when provided', () => {
    const { lastFrame } = render(
      <RunningStep {...base} detail="Analyzing 10/20 files" quaternaryDetail="Generating token definitions..." />,
    );
    expect(lastFrame() ?? '').toContain('Generating token definitions...');
  });

  it('replaces a completed detail spinner with a green checkmark', () => {
    const { lastFrame } = render(
      <RunningStep
        {...base}
        detail="Analyzing 10/20 files"
        secondaryDetail="Composition mapping complete"
        secondaryComplete
      />,
    );
    expect(lastFrame() ?? '').toContain('✓');
    expect(lastFrame() ?? '').toContain('Composition mapping complete');
  });

  it('replaces the primary spinner with a green checkmark when complete', () => {
    const { lastFrame } = render(<RunningStep {...base} detail="Scanned 42 files" detailComplete />);
    expect(lastFrame() ?? '').toContain('✓');
    expect(lastFrame() ?? '').toContain('Scanned 42 files');
  });
});
