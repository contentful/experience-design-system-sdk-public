import type { SetupActionDependencies } from './types.js';

/**
 * Ask a yes/no question that defaults to the operator's current setting.
 *
 * Empty input — and anything that is not a yes or a no — keeps the current
 * value, so pressing Enter through the wizard never silently changes a setting.
 */
export async function askYesNo(
  ask: SetupActionDependencies['ask'],
  question: string,
  defaultValue: boolean,
): Promise<boolean> {
  const hint = defaultValue ? '[Y/n]' : '[y/N]';
  const answer = (await ask(`${question} ${hint} `)).trim().toLowerCase();
  if (answer.startsWith('y')) return true;
  if (answer.startsWith('n')) return false;
  return defaultValue;
}
