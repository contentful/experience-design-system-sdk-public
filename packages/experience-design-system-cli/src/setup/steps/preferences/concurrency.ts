import { emit, type SetupActionDependencies } from '../../lib/types.js';

export const CONCURRENCY_HELP = 'Analyzes more components at once, which is faster on machines with spare cores.';

const PROFILE_VARIABLE = 'EDS_EXTRACT_CONCURRENCY';

export async function configureConcurrency(dependencies: SetupActionDependencies, profilePath: string): Promise<void> {
  emit(dependencies, 'page', CONCURRENCY_HELP);
  if (await dependencies.profileContains(profilePath, PROFILE_VARIABLE)) return;
  if (!(await dependencies.confirm('Speed up component analysis on this machine?', false))) return;
  await dependencies.appendToProfile(profilePath, `# experiences performance\nexport ${PROFILE_VARIABLE}=8`);
}
