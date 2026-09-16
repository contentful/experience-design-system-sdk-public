import { askYesNo } from '../../lib/yes-no-prompt.js';
import { emit, type SetupActionDependencies } from '../../lib/types.js';

export const AUTO_FILTER_HELP = 'Filters out components irrelevant to experience orchestration during extraction.';

export async function promptAutoFilterPreference(
  ask: SetupActionDependencies['ask'],
  current?: boolean,
): Promise<boolean> {
  return askYesNo(ask, 'Enable AI auto-filter by default?', current ?? true);
}

export async function configureAutoFilter(dependencies: SetupActionDependencies): Promise<void> {
  emit(dependencies, 'page', AUTO_FILTER_HELP);
  const stored = await dependencies.readCredentials();
  const autoFilter = await promptAutoFilterPreference(dependencies.ask, stored.autoFilter);
  if (autoFilter !== (stored.autoFilter ?? true)) await dependencies.writeCredentials({ ...stored, autoFilter });
}
