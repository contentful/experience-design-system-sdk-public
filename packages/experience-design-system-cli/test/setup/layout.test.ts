import { describe, expect, it } from 'vitest';
import {
  SETUP_SCREENS,
  WIDE_STEPPER_MIN_COLUMNS,
  countRequiredFailures,
  formatSetupCompletionMessage,
  setupStepperEntries,
  setupStepperSeparator,
  shouldAlignVersionRight,
  shouldUseWideStepper,
  type SetupResultEntry,
} from '../../src/setup/lib/layout.js';

describe('setup screens', () => {
  it('defines the four setup screens in order', () => {
    expect(SETUP_SCREENS).toEqual([
      { title: 'Prerequisites', kind: 'required' },
      { title: 'Coding agent', kind: 'required' },
      { title: 'Contentful', kind: 'optional' },
      { title: 'Preferences', kind: 'optional' },
    ]);
  });
});

describe('setup stepper model', () => {
  it('marks earlier steps complete, the current step active, and later steps pending', () => {
    expect(setupStepperEntries(2, 120).map(({ step, state }) => ({ step, state }))).toEqual([
      { step: 1, state: 'complete' },
      { step: 2, state: 'active' },
      { step: 3, state: 'pending' },
      { step: 4, state: 'pending' },
    ]);
  });

  it('labels wide steppers with titles', () => {
    expect(setupStepperEntries(2, 120).map((entry) => entry.label)).toEqual([
      '✓ Prerequisites',
      '[2 Coding agent]',
      '3 Contentful',
      '4 Preferences',
    ]);
  });

  it('labels compact steppers with state-only markers', () => {
    expect(setupStepperEntries(3, 30).map((entry) => entry.label)).toEqual(['✓', '✓', '[3]', '4']);
  });

  it('switches to labels at the exact visible width threshold', () => {
    expect(WIDE_STEPPER_MIN_COLUMNS).toBe(71);
    expect(shouldUseWideStepper(70)).toBe(false);
    expect(shouldUseWideStepper(71)).toBe(true);
  });

  it('falls back to the compact stepper when the terminal width is unknown', () => {
    expect(shouldUseWideStepper(undefined)).toBe(false);
    expect(setupStepperEntries(1).map((entry) => entry.label)).toEqual(['[1]', '2', '3', '4']);
  });

  it('separates wide steps with a dot and compact steps with spaces', () => {
    expect(setupStepperSeparator(120)).toBe('  ·  ');
    expect(setupStepperSeparator(30)).toBe('  ');
  });
});

describe('setup header alignment', () => {
  it('right-aligns the version when the terminal is wide enough', () => {
    expect(shouldAlignVersionRight('2.27.1', 60)).toBe(true);
  });

  it('keeps the version inline on narrow terminals', () => {
    expect(shouldAlignVersionRight('2.27.1', 20)).toBe(false);
    expect(shouldAlignVersionRight('2.27.1', undefined)).toBe(false);
  });

  it('right-aligns at the exact width that fits the title, gap, and version', () => {
    // 'experiences setup' (17) + gap (2) + 'v2.27.1' (7) = 26 columns.
    expect(shouldAlignVersionRight('2.27.1', 26)).toBe(true);
    expect(shouldAlignVersionRight('2.27.1', 25)).toBe(false);
  });
});

describe('setup summary model', () => {
  const results: SetupResultEntry[] = [
    { name: 'Node.js 24+', status: 'completed', required: true },
    { name: 'pnpm', status: 'completed', required: true },
    { name: 'coding agent', status: 'skipped', required: false },
    { name: 'Contentful credentials', status: 'failed', required: false },
  ];

  it('ignores optional failures when counting required failures', () => {
    expect(countRequiredFailures(results)).toBe(0);
    expect(formatSetupCompletionMessage(results)).toBe('✓ Setup complete. You can now run: experiences import');
  });

  it('reports the number of incomplete required steps', () => {
    const withFailures: SetupResultEntry[] = [
      ...results,
      { name: 'install & build', status: 'failed', required: true },
    ];

    expect(countRequiredFailures(withFailures)).toBe(1);
    expect(formatSetupCompletionMessage(withFailures)).toBe('⚠ 1 required step incomplete.');
  });

  it('pluralizes multiple incomplete required steps', () => {
    const withFailures: SetupResultEntry[] = [
      { name: 'pnpm', status: 'failed', required: true },
      { name: 'install & build', status: 'failed', required: true },
    ];

    expect(formatSetupCompletionMessage(withFailures)).toBe('⚠ 2 required steps incomplete.');
  });
});
