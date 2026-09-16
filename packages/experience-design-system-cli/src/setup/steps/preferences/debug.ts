import { askYesNo } from '../../lib/yes-no-prompt.js';
import { emit, type SetupActionDependencies } from '../../lib/types.js';

export const DEBUG_HELP = 'Writes a verbose trace of every command decision, for troubleshooting.';

export async function promptDebugModePreference(
  ask: SetupActionDependencies['ask'],
  current?: boolean,
): Promise<boolean> {
  return askYesNo(ask, 'Enable debug logging by default?', current ?? false);
}

export async function configureDebug(dependencies: SetupActionDependencies): Promise<void> {
  emit(dependencies, 'page', DEBUG_HELP);
  const stored = await dependencies.readCredentials();
  const debug = await promptDebugModePreference(dependencies.ask, stored.debug);
  if (debug !== (stored.debug ?? false)) await dependencies.writeCredentials({ ...stored, debug });
}
