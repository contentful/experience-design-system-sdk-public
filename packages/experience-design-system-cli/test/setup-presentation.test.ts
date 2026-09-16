import { describe, expect, it } from 'vitest';
import { formatSetupScreenTransition, shouldClearSetupScreen } from '../src/setup/command.js';
import { SETUP_SCREENS, formatSetupHeader, formatSetupScreen, formatSetupStepper } from '../src/setup/screen.js';

const stripAnsi = (value: string): string => value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');

describe('setup presentation', () => {
  it('clears setup screens only in an interactive terminal', () => {
    expect(shouldClearSetupScreen(true)).toBe(true);
    expect(shouldClearSetupScreen(false)).toBe(false);
  });

  it('writes a display-only clear and home sequence for interactive screen transitions', () => {
    expect(formatSetupScreenTransition(true, 2)).toBe('\x1b[2J\x1b[H');
  });

  it('does not write a transition sequence for the first or non-interactive screen', () => {
    expect(formatSetupScreenTransition(true, 1)).toBe('');
    expect(formatSetupScreenTransition(false, 2)).toBe('');
  });

  it('defines the four setup screens in order', () => {
    expect(SETUP_SCREENS).toEqual([
      { title: 'Prerequisites', kind: 'required' },
      { title: 'Coding agent', kind: 'required' },
      { title: 'Contentful', kind: 'optional' },
      { title: 'Preferences', kind: 'optional' },
    ]);
  });

  it('right-aligns the CLI version when the terminal is wide enough', () => {
    const output = stripAnsi(formatSetupHeader('2.27.1', 60));
    const [titleLine] = output.trimStart().split('\n');

    expect(titleLine).toBe('experiences setup'.padEnd(53) + 'v2.27.1');
  });

  it('keeps the version inline on narrow terminals', () => {
    const output = stripAnsi(formatSetupHeader('2.27.1', 20));

    expect(output).toContain('experiences setup  v2.27.1');
  });

  it('shows labels and marks the active step in a wide stepper', () => {
    const output = stripAnsi(formatSetupStepper(1, 120));

    expect(output).toContain('[1 Prerequisites]');
    expect(output).toContain('2 Coding agent');
    expect(output).toContain('3 Contentful');
    expect(output).toContain('4 Preferences');
  });

  it('bolds the active step in a wide stepper', () => {
    const output = formatSetupStepper(1, 120);

    expect(output).toContain('\x1b[1m[1 Prerequisites]\x1b[0m');
  });

  it('marks completed steps and dims future steps in a wide stepper', () => {
    const output = formatSetupStepper(2, 120);

    expect(output).toContain('\x1b[32m✓\x1b[0m Prerequisites');
    expect(output).toContain('\x1b[2m3 Contentful\x1b[0m');
    expect(output).toContain('\x1b[2m4 Preferences\x1b[0m');
  });

  it('uses the compact stepper immediately below the labelled width threshold', () => {
    const output = stripAnsi(formatSetupStepper(1, 70));

    expect(output).toBe('[1]  2  3  4\n');
  });

  it('uses the labelled stepper at its exact visible width threshold', () => {
    const output = stripAnsi(formatSetupStepper(1, 71));

    expect(output).toContain('[1 Prerequisites]');
  });

  it('uses the compact stepper when the terminal width is unknown', () => {
    const output = stripAnsi(formatSetupStepper(1));

    expect(output).toBe('[1]  2  3  4\n');
  });

  it('uses state-only markers in a narrow stepper', () => {
    const output = stripAnsi(formatSetupStepper(3, 30));

    expect(output).toBe('✓  ✓  [3]  4\n');
  });

  it('combines the header, stepper, and active screen title', () => {
    const output = stripAnsi(formatSetupScreen('2.27.1', 2, 'Coding agent', 'required', 120));

    expect(output).toContain('experiences setup');
    expect(output).toContain('[2 Coding agent]');
    expect(output).toContain('[2/4] Coding agent · required');
  });
});
