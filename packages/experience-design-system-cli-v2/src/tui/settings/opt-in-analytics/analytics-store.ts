import { readV1Store, writeV1Store } from '../utils/v1-store.js';

export interface AnalyticsSetting {
  enabled: boolean;
}

// v1 uses inverted logic: analyticsDisabled: true = OFF
export async function readAnalyticsSetting(): Promise<AnalyticsSetting> {
  const store = await readV1Store();
  const analyticsDisabled = store.analyticsDisabled as boolean | undefined;
  return { enabled: analyticsDisabled !== true };
}

export async function writeAnalyticsSetting(setting: AnalyticsSetting): Promise<void> {
  const existing = await readV1Store();
  const updated = {
    ...existing,
    analyticsDisabled: !setting.enabled,
  };
  await writeV1Store(updated);
}
