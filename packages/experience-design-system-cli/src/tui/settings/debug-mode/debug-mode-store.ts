import { readSettings, updateSettings } from '@contentful/experience-design-system-types/config';

/** How long a debug log is kept before the CLI deletes it. Only these values are offered. */
export const RETENTION_CHOICES = [30, 60, 90] as const;
type RetentionDays = (typeof RETENTION_CHOICES)[number];

const DEFAULT_RETENTION_DAYS: RetentionDays = 30;

export type DebugModeSetting = {
  enabled: boolean;
  retentionDays: RetentionDays;
};

/**
 * The retention to use for whatever is in the settings file. Anything other than 30, 60 or 90 (a hand edit, an old
 * file) falls back to the default, so a bad value can never delete anything sooner than the default would.
 */
function toRetentionDays(value: unknown): RetentionDays {
  return RETENTION_CHOICES.find((choice) => choice === value) ?? DEFAULT_RETENTION_DAYS;
}

export async function readDebugModeSetting(): Promise<DebugModeSetting> {
  const { debugMode } = await readSettings();
  const saved = (debugMode ?? {}) as Partial<Record<keyof DebugModeSetting, unknown>>;
  return {
    enabled: typeof saved.enabled === 'boolean' ? saved.enabled : true,
    retentionDays: toRetentionDays(saved.retentionDays),
  };
}

/** Saves the given fields and keeps the others, so turning logging off does not forget the retention. */
export async function writeDebugModeSetting(change: Partial<DebugModeSetting>): Promise<void> {
  await updateSettings({ debugMode: { ...(await readDebugModeSetting()), ...change } });
}
