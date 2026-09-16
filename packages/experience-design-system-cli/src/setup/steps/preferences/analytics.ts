import { askYesNo } from '../../lib/yes-no-prompt.js';
import { emit, type SetupActionDependencies } from '../../lib/types.js';

export const ANALYTICS_HELP = 'Shares anonymous usage data about which CLI commands run.';

/** Returns whether analytics should be *disabled*, matching the stored field. */
export async function promptAnalyticsPreference(
  ask: SetupActionDependencies['ask'],
  current?: boolean,
): Promise<boolean> {
  return askYesNo(ask, 'Disable anonymous usage analytics?', current ?? false);
}

export async function configureAnalytics(dependencies: SetupActionDependencies): Promise<void> {
  emit(dependencies, 'page', ANALYTICS_HELP);
  const stored = await dependencies.readCredentials();
  const analyticsDisabled = await promptAnalyticsPreference(dependencies.ask, stored.analyticsDisabled);
  if (analyticsDisabled !== (stored.analyticsDisabled ?? false))
    await dependencies.writeCredentials({ ...stored, analyticsDisabled });
}
