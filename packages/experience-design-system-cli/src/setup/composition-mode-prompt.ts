import type { CompositionMode } from '../lib/composition-mode.js';
import { promptBooleanPreference } from './prompt-helpers.js';

/**
 * Setup prompts for composition (spec T10). Parallels `promptAutoFilterPreference`
 * — injectable `ask` for TTY-free unit testing.
 *
 * (a) Composite-mode default. Default N → atomic (composition OFF); the
 *     low-surprise default. `--composite` opts in per invocation.
 */
export async function promptCompositeModePreference(
  ask: (q: string) => Promise<string>,
  current?: CompositionMode,
): Promise<CompositionMode> {
  const defaultValue: CompositionMode = current ?? 'atomic';
  const hint = defaultValue === 'composite' ? '[Y/n]' : '[y/N]';
  const answer = (await ask(`  Enable composite (embedded-component) mode by default? ${hint} `)).trim().toLowerCase();
  if (answer === '') return defaultValue;
  if (answer.startsWith('y')) return 'composite';
  if (answer.startsWith('n')) return 'atomic';
  return defaultValue;
}

/**
 * (b) Agentic mapping resolution. Default N — opt-in (it costs tokens and the
 *     output needs review), and only meaningful in composite mode.
 */
export async function promptAgenticResolutionPreference(
  ask: (q: string) => Promise<string>,
  current?: boolean,
): Promise<boolean> {
  return promptBooleanPreference(ask, current, false, 'Enable agentic mapping resolution when no groups are found?');
}
