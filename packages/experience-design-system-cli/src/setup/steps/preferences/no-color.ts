import { emit, type SetupActionDependencies } from '../../lib/types.js';

export const NO_COLOR_HELP = 'Prints plain text with no color, which suits CI logs and basic terminals.';

const PROFILE_VARIABLE = 'NO_COLOR';

export async function configureNoColor(dependencies: SetupActionDependencies, profilePath: string): Promise<void> {
  emit(dependencies, 'page', NO_COLOR_HELP);
  if (!(await dependencies.confirm('Turn off colored output?', false))) return;
  if (await dependencies.profileContains(profilePath, PROFILE_VARIABLE)) return;
  await dependencies.appendToProfile(profilePath, `export ${PROFILE_VARIABLE}=1`);
}
