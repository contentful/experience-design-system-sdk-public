// What the import generates. The user chooses once, on the preflight screen, and the choice is held until the import ends.
// Every run generates new files: reusing files from an earlier run is a separate piece of work.
export type ImportTarget = 'both' | 'tokens' | 'components';

export const IMPORT_TARGET_OPTIONS: ReadonlyArray<{ target: ImportTarget; label: string }> = [
  { target: 'both', label: 'Tokens and components' },
  { target: 'tokens', label: 'Tokens only' },
  { target: 'components', label: 'Components only' },
];

// The screens and stages of an import, in the order they run. Everything that depends on the chosen target (the screens
// shown, the step numbers and totals, the extraction rows, the Back target) reads from the lists below, so a mode is
// described in one place.
export type ImportStepId =
  | 'project'
  | 'token-file'
  | 'path-validation'
  | 'credentials'
  | 'component-extraction'
  | 'token-generation'
  | 'scope-gate'
  | 'generation'
  | 'review'
  | 'save-push';

// Token generation and component extraction are separate jobs. When both run they share the extraction screen and run at
// the same time, so they are two entries here but one stretch of waiting for the user. `generation` is the component half
// (generate components, then map tokens); the tokens themselves are made by `token-generation`.
const STEPS: Record<ImportTarget, readonly ImportStepId[]> = {
  both: [
    'project',
    'token-file',
    'path-validation',
    'credentials',
    'component-extraction',
    'token-generation',
    'scope-gate',
    'generation',
    'review',
    'save-push',
  ],
  // The component stages are skipped, and with them token mapping, which needs components to map to. There is no project
  // to ask for: the token file is the only input. The credentials screen stays until it is known whether pushing tokens
  // needs them.
  tokens: ['token-file', 'credentials', 'token-generation', 'save-push'],
  // No token file, so no token generation and no token mapping.
  components: [
    'project',
    'path-validation',
    'credentials',
    'component-extraction',
    'scope-gate',
    'generation',
    'review',
    'save-push',
  ],
};

export function stepsFor(target: ImportTarget): readonly ImportStepId[] {
  return STEPS[target];
}

/** The screen Back goes to from `current`: the one before it in this mode, or the preflight from the first step. */
function previousStep(target: ImportTarget, current: ImportStepId): ImportStepId | 'preflight' {
  const steps = STEPS[target];
  const index = steps.indexOf(current);
  return index > 0 ? steps[index - 1]! : 'preflight';
}

// The steps that ask the user for something, and the answer each one leaves behind. Credentials are not here: the
// credentials screen is the last input, and finishing it starts the run.
export interface InputAnswers {
  projectPath?: string;
  tokensPath?: string;
  scannedFiles?: string[];
}

const ANSWER_OF: Partial<Record<ImportStepId, keyof InputAnswers>> = {
  project: 'projectPath',
  'token-file': 'tokensPath',
  'path-validation': 'scannedFiles',
};

/**
 * The input screen to show: the first step of this mode whose answer is still missing, or 'credentials' once every
 * earlier one is answered. A mode never shows a screen it does not list, so skipping one needs no special case.
 */
export function currentInputStep(
  target: ImportTarget,
  answers: InputAnswers,
): Extract<ImportStepId, 'project' | 'token-file' | 'path-validation' | 'credentials'> {
  for (const step of STEPS[target]) {
    const answer = ANSWER_OF[step];
    if (answer === undefined) return 'credentials';
    if (answers[answer] === undefined) return step as 'project' | 'token-file' | 'path-validation';
  }
  return 'credentials';
}

/**
 * What Back from `current` does: leave for the preflight when it is the first screen of the mode, otherwise clear the
 * previous step's answer so that screen shows again.
 */
export function goBack(
  target: ImportTarget,
  current: ImportStepId,
  answers: InputAnswers,
): { to: 'preflight' } | { to: 'step'; answers: InputAnswers } {
  const previous = previousStep(target, current);
  if (previous === 'preflight') return { to: 'preflight' };
  const answer = ANSWER_OF[previous];
  if (answer === undefined) return { to: 'step', answers };
  const { [answer]: _cleared, ...rest } = answers;
  return { to: 'step', answers: rest };
}

/**
 * Where a run writes its files when it has no project to put them in: the Root Project Directory setting if there is
 * one, otherwise the folder the token file is in. Components runs always have a project and use it.
 */
export function runBaseDir(input: { projectPath?: string; tokensPath?: string; configuredBaseDir?: string }): string {
  if (input.projectPath) return input.projectPath;
  if (input.configuredBaseDir) return input.configuredBaseDir;
  const tokensPath = input.tokensPath ?? '';
  const slash = tokensPath.lastIndexOf('/');
  return slash > 0 ? tokensPath.slice(0, slash) : '.';
}

interface FocusKey {
  upArrow: boolean;
  downArrow: boolean;
}

/** The option focused after a key: arrows move through the list and wrap around. */
export function moveFocus(focus: number, key: FocusKey, count: number): number {
  if (key.upArrow) return (focus - 1 + count) % count;
  if (key.downArrow) return (focus + 1) % count;
  return focus;
}
