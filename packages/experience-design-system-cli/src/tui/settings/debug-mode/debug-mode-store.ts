import { readSettings, updateSettings } from '@contentful/experience-design-system-types/config';

export type DebugModeSetting = {
  enabled: boolean;
};

const DEFAULT_DEBUG_MODE_SETTING: DebugModeSetting = {
  enabled: true,
};

export async function readDebugModeSetting(): Promise<DebugModeSetting> {
  const { debugMode } = await readSettings();
  return { ...DEFAULT_DEBUG_MODE_SETTING, ...(debugMode as Partial<DebugModeSetting> | undefined) };
}

export async function writeDebugModeSetting(setting: DebugModeSetting): Promise<void> {
  await updateSettings({ debugMode: setting });
}
