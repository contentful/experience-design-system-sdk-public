import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { PushingStep } from '../../../../src/import/tui/steps/PushingStep.js';
import type { PushProgress } from '../../../../src/import/tui/push-progress.js';

function stripAnsi(s: string): string {
  return s.replace(/\[[0-9;]*m/g, '');
}

describe('PushingStep', () => {
  it('renders title, spinner, and aggregate entities line', () => {
    const progress: PushProgress = {
      kind: 'progress',
      processed: 4,
      total: 22,
      current: null,
    };
    const { lastFrame } = render(
      <PushingStep stepNumber={5} totalSteps={5} progress={progress} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('Push to Contentful');
    expect(out).toContain('4/22 entities');
  });

  it('shows operation id when progress is queued', () => {
    const { lastFrame } = render(
      <PushingStep
        stepNumber={5}
        totalSteps={5}
        progress={{ kind: 'queued', operationId: 'op-1234' }}
      />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).toContain('op-1234');
  });

  it('shows Now processing only when progress has current name', () => {
    const withName = render(
      <PushingStep
        stepNumber={5}
        totalSteps={5}
        progress={{ kind: 'progress', processed: 1, total: 22, current: 'Button' }}
      />,
    );
    expect(stripAnsi(withName.lastFrame() ?? '')).toContain('Now processing: Button');

    const noName = render(
      <PushingStep
        stepNumber={5}
        totalSteps={5}
        progress={{ kind: 'progress', processed: 1, total: 22, current: null }}
      />,
    );
    expect(stripAnsi(noName.lastFrame() ?? '')).not.toContain('Now processing');

    const queued = render(
      <PushingStep
        stepNumber={5}
        totalSteps={5}
        progress={{ kind: 'queued', operationId: 'x' }}
      />,
    );
    expect(stripAnsi(queued.lastFrame() ?? '')).not.toContain('Now processing');
  });

  it('does not render per-bucket rows (Creating/Updating/Deleting) or entity section labels', () => {
    const progress: PushProgress = {
      kind: 'progress',
      processed: 4,
      total: 22,
      current: null,
    };
    const { lastFrame } = render(
      <PushingStep stepNumber={5} totalSteps={5} progress={progress} />,
    );
    const out = stripAnsi(lastFrame() ?? '');
    expect(out).not.toMatch(/Creating\s+\?/);
    expect(out).not.toMatch(/Updating\s+\?/);
    expect(out).not.toMatch(/Deleting\s+\?/);
    expect(out).not.toContain('Component types');
    // Aggregate line still present.
    expect(out).toContain('4/22 entities');
  });
});
