import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { SetupStepper } from '../../src/setup/SetupStepper.js';

describe('SetupStepper', () => {
  it('shows labelled steps and marks the active one on a wide terminal', () => {
    const { lastFrame } = render(<SetupStepper activeStep={1} columns={120} />);

    expect(lastFrame()).toBe('[1 Prerequisites]  ·  2 Coding agent  ·  3 Contentful  ·  4 Preferences');
  });

  it('checks completed steps and keeps future steps unmarked', () => {
    const { lastFrame } = render(<SetupStepper activeStep={3} columns={120} />);

    expect(lastFrame()).toBe('✓ Prerequisites  ·  ✓ Coding agent  ·  [3 Contentful]  ·  4 Preferences');
  });

  it('uses the compact stepper immediately below the labelled width threshold', () => {
    const { lastFrame } = render(<SetupStepper activeStep={1} columns={70} />);

    expect(lastFrame()).toBe('[1]  2  3  4');
  });

  it('uses the labelled stepper at its exact visible width threshold', () => {
    const { lastFrame } = render(<SetupStepper activeStep={1} columns={71} />);

    expect(lastFrame()).toContain('[1 Prerequisites]');
  });

  it('uses state-only markers in a compact stepper', () => {
    const { lastFrame } = render(<SetupStepper activeStep={3} columns={30} />);

    expect(lastFrame()).toBe('✓  ✓  [3]  4');
  });

  it('falls back to the compact stepper when the terminal width is unknown', () => {
    const { lastFrame } = render(<SetupStepper activeStep={1} />);

    expect(lastFrame()).toBe('[1]  2  3  4');
  });
});
