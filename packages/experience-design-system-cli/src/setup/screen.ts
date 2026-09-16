export const SETUP_SCREENS = [
  { title: 'Prerequisites', kind: 'required' },
  { title: 'Coding agent', kind: 'required' },
  { title: 'Contentful', kind: 'optional' },
  { title: 'Preferences', kind: 'optional' },
] as const;

export const SETUP_TITLE = 'experiences setup';

const WIDE_STEPPER_SEPARATOR = '  ·  ';
const COMPACT_STEPPER_SEPARATOR = '  ';
const HEADER_INLINE_GAP = 2;

export const WIDE_STEPPER_MIN_COLUMNS = SETUP_SCREENS.map((screen, index) => {
  const label = `${index + 1} ${screen.title}`;
  return index === 0 ? `[${label}]` : label;
}).join(WIDE_STEPPER_SEPARATOR).length;

export type SetupStepState = 'complete' | 'active' | 'pending';

export interface SetupStepperEntry {
  step: number;
  title: string;
  state: SetupStepState;
  label: string;
}

/**
 * Labelled steps only fit once the terminal is at least as wide as the joined
 * stepper; narrower terminals fall back to numbered markers so it never wraps.
 */
export function shouldUseWideStepper(columns?: number): boolean {
  return columns !== undefined && columns >= WIDE_STEPPER_MIN_COLUMNS;
}

export function setupStepperSeparator(columns?: number): string {
  return shouldUseWideStepper(columns) ? WIDE_STEPPER_SEPARATOR : COMPACT_STEPPER_SEPARATOR;
}

export function setupStepperEntries(activeStep: number, columns?: number): SetupStepperEntry[] {
  const isWide = shouldUseWideStepper(columns);

  return SETUP_SCREENS.map((screen, index) => {
    const step = index + 1;
    const state: SetupStepState = step < activeStep ? 'complete' : step === activeStep ? 'active' : 'pending';
    const compactLabel = state === 'complete' ? '✓' : state === 'active' ? `[${step}]` : `${step}`;
    const wideLabel =
      state === 'complete'
        ? `✓ ${screen.title}`
        : state === 'active'
          ? `[${step} ${screen.title}]`
          : `${step} ${screen.title}`;

    return { step, title: screen.title, state, label: isWide ? wideLabel : compactLabel };
  });
}

/**
 * The version sits flush right when the terminal can hold the title, a gap, and
 * the version; otherwise it stays inline directly after the title.
 */
export function shouldAlignVersionRight(version: string, columns?: number): boolean {
  const contentWidth = SETUP_TITLE.length + HEADER_INLINE_GAP + `v${version}`.length;
  return columns !== undefined && columns >= contentWidth;
}

export function setupScreenLabel(activeStep: number): string {
  const screen = SETUP_SCREENS[activeStep - 1];
  if (!screen) return '';
  return `[${activeStep}/${SETUP_SCREENS.length}] ${screen.title} · ${screen.kind}`;
}

export type SetupResultStatus = 'completed' | 'skipped' | 'failed';

export interface SetupResultEntry {
  name: string;
  status: SetupResultStatus;
  required: boolean;
}

export function countRequiredFailures(results: readonly SetupResultEntry[]): number {
  return results.filter((result) => result.required && result.status === 'failed').length;
}

export function formatSetupCompletionMessage(results: readonly SetupResultEntry[]): string {
  const requiredFailed = countRequiredFailures(results);
  if (requiredFailed === 0) return '✓ Setup complete. You can now run: experiences import';
  return `⚠ ${requiredFailed} required step${requiredFailed === 1 ? '' : 's'} incomplete.`;
}
