import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import { PushingStep } from '../../../../src/import/tui/steps/PushingStep.js';
import type { PushExpected, PushProgress } from '../../../../src/import/tui/push-progress.js';

const FULL_EXPECTED: PushExpected = {
  componentTypes: { create: 7, update: 3, remove: 1 },
  designTokens: { create: 5, update: 2, remove: 4 },
};

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

describe('PushingStep', () => {
  it('renders rows for all six expected actions when populated', () => {
    const { lastFrame } = render(
      <PushingStep
        stepNumber={5}
        totalSteps={5}
        expected={FULL_EXPECTED}
        progress={{ kind: 'queued', operationId: 'op-1234' }}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Component types');
    expect(out).toContain('Design tokens');
    expect(out).toMatch(/Creating[^\n]*7/);
    expect(out).toMatch(/Updating[^\n]*3/);
    expect(out).toMatch(/Deleting[^\n]*1/);
    expect(out).toMatch(/Creating[^\n]*5/);
    expect(out).toMatch(/Updating[^\n]*2/);
    expect(out).toMatch(/Deleting[^\n]*4/);
  });

  it('hides rows where expected count is zero', () => {
    const expected: PushExpected = {
      componentTypes: { create: 2, update: 0, remove: 0 },
      designTokens: { create: 0, update: 0, remove: 0 },
    };
    const { lastFrame } = render(
      <PushingStep
        stepNumber={5}
        totalSteps={5}
        expected={expected}
        progress={{ kind: 'queued', operationId: 'op-1' }}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('Creating');
    expect(out).not.toContain('Updating');
    expect(out).not.toContain('Deleting');
    expect(out).not.toContain('Design tokens');
  });

  it('shows ?/N on the left when progress is queued', () => {
    const { lastFrame } = render(
      <PushingStep
        stepNumber={5}
        totalSteps={5}
        expected={FULL_EXPECTED}
        progress={{ kind: 'queued', operationId: 'op-1' }}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toMatch(/\?\/7/);
  });

  it('shows global X/total entities line when progress is in flight', () => {
    const progress: PushProgress = {
      kind: 'progress',
      processed: 4,
      total: 22,
      current: null,
    };
    const { lastFrame } = render(
      <PushingStep
        stepNumber={5}
        totalSteps={5}
        expected={FULL_EXPECTED}
        progress={progress}
      />,
    );
    const out = lastFrame() ?? '';
    expect(out).toContain('4/22 entities');
  });

  it('shows Now processing only when progress has current name', () => {
    const withName = render(
      <PushingStep
        stepNumber={5}
        totalSteps={5}
        expected={FULL_EXPECTED}
        progress={{ kind: 'progress', processed: 1, total: 22, current: 'Button' }}
      />,
    );
    expect(stripAnsi(withName.lastFrame() ?? '')).toContain('Now processing: Button');

    const noName = render(
      <PushingStep
        stepNumber={5}
        totalSteps={5}
        expected={FULL_EXPECTED}
        progress={{ kind: 'progress', processed: 1, total: 22, current: null }}
      />,
    );
    expect(stripAnsi(noName.lastFrame() ?? '')).not.toContain('Now processing');

    const queued = render(
      <PushingStep
        stepNumber={5}
        totalSteps={5}
        expected={FULL_EXPECTED}
        progress={{ kind: 'queued', operationId: 'x' }}
      />,
    );
    expect(stripAnsi(queued.lastFrame() ?? '')).not.toContain('Now processing');
  });
});
