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
  // The component stages are skipped, and with them token mapping, which needs components to map to. The credentials
  // screen stays until it is known whether pushing tokens needs them.
  tokens: ['project', 'token-file', 'credentials', 'token-generation', 'save-push'],
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
export function previousStep(target: ImportTarget, current: ImportStepId): ImportStepId | 'preflight' {
  const steps = STEPS[target];
  const index = steps.indexOf(current);
  return index > 0 ? steps[index - 1]! : 'preflight';
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
