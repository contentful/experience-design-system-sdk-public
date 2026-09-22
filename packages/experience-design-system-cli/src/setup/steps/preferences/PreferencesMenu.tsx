import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Select } from '@inkjs/ui';
import { readExperiencesCredentials, type ExperiencesCredentials } from '../../../credentials-store.js';
import { profileContains } from '../../lib/shell.js';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { StepLayout, type StepDone } from '../StepLayout.js';
import { PREFERENCE_OPTIONS, type PreferenceKey } from './index.js';
import { PROFILE_VARIABLE as CONCURRENCY_VARIABLE } from './concurrency.js';
import { PROFILE_VARIABLE as NO_COLOR_VARIABLE } from './no-color.js';

/** The value the trailing row reports; no PreferenceKey contains a colon. */
const DONE_VALUE = 'menu:done';

export const PREFERENCES_MENU_HELP = 'Every preference already has a working default — open one only to change it.';

/**
 * Whether a preference still sits on its default or the operator has moved it.
 * The menu marks the two differently so a glance shows what has been touched.
 */
export type PreferenceState = 'default' | 'changed';

export type PreferenceValue = {
  /** What the setting currently does, in the operator's words. */
  text: string;
  state: PreferenceState;
};

/** What each preference currently resolves to, for the menu's summary column. */
export type PreferenceSummary = Record<PreferenceKey, PreferenceValue>;

/** Filled when a setting is off its default, hollow when it is untouched. */
const MARKER: Record<PreferenceState, string> = { default: '○', changed: '●' };

type PreferencesMenuProps = {
  profilePath: string;
  /** Preferences changed so far this visit; decides what Done reports. */
  changed: ReadonlySet<PreferenceKey>;
  onOpen: (key: PreferenceKey) => void;
  onDone: StepDone;
};

/**
 * Describe each preference the way the operator reads it, so a row says what the
 * setting currently does rather than which field stores it.
 */
export function summarisePreferences(
  credentials: ExperiencesCredentials,
  profile: { concurrency: boolean; noColor: boolean },
): PreferenceSummary {
  // Each preference names its default, so "changed" means the stored value
  // differs from what an untouched install would do — not merely that a field
  // is present in the credentials file.
  const autoFilter = credentials.autoFilter ?? true;
  const debug = credentials.debug ?? false;
  const analyticsDisabled = credentials.analyticsDisabled ?? false;

  return {
    autoFilter: value(autoFilter ? 'Filtering irrelevant components' : 'Keeping every component', autoFilter === true),
    concurrency: value(profile.concurrency ? 'More components at once' : 'Default', !profile.concurrency),
    customPrompts: describeCustomPrompts(credentials),
    debug: value(debug ? 'Verbose traces' : 'Quiet', debug === false),
    analytics: value(analyticsDisabled ? 'Not sharing usage data' : 'Sharing usage data', analyticsDisabled === false),
    noColor: value(profile.noColor ? 'Colors off' : 'Colors on', !profile.noColor),
  };
}

function value(text: string, isDefault: boolean): PreferenceValue {
  return { text, state: isDefault ? 'default' : 'changed' };
}

function describeCustomPrompts(credentials: ExperiencesCredentials): PreferenceValue {
  const count = [credentials.selectPromptPath, credentials.generatePromptPath].filter(Boolean).length;
  if (count === 0) return value('Built-in prompts', true);
  return value(count === 2 ? 'Custom select and generate' : 'One custom prompt', false);
}

/**
 * The preferences step opens here instead of walking every setting, so the
 * operator reads the current values and opens only what they want to change.
 */
export function PreferencesMenu({ profilePath, changed, onOpen, onDone }: PreferencesMenuProps): React.ReactElement {
  const [summary, setSummary] = useState<PreferenceSummary | null>(null);

  const load = useCallback(async (): Promise<PreferenceSummary> => {
    const [credentials, concurrency, noColor] = await Promise.all([
      readExperiencesCredentials(),
      profileContains(profilePath, CONCURRENCY_VARIABLE),
      profileContains(profilePath, NO_COLOR_VARIABLE),
    ]);
    return summarisePreferences(credentials, { concurrency, noColor });
  }, [profilePath]);

  // The step unmounts this menu while a preference screen is open, so mounting is
  // what refreshes the rows — a setting the operator just changed reads back here.
  useEffect(() => {
    let active = true;
    void load().then((next) => {
      if (active) setSummary(next);
    });
    return () => {
      active = false;
    };
  }, [load]);

  if (!summary) return <Text dimColor>Reading saved preferences…</Text>;

  const labelWidth = Math.max(...PREFERENCE_OPTIONS.map((option) => option.label.length));
  const options = [
    ...PREFERENCE_OPTIONS.map((option) => {
      const { text, state } = summary[option.key];
      return {
        label: `${MARKER[state]} ${option.label.padEnd(labelWidth)}  ${text}`,
        value: option.key as string,
      };
    }),
    { label: 'Done', value: DONE_VALUE },
  ];

  return (
    <StepLayout
      helpText={PREFERENCES_MENU_HELP}
      prompt={
        <Box flexDirection="column">
          <Text>Preferences — open one to change it, or choose Done</Text>
          <Box marginTop={1}>
            <Select
              options={options}
              visibleOptionCount={options.length}
              onChange={(value) => {
                if (value === DONE_VALUE) {
                  onDone(changed.size > 0 ? 'completed' : 'skipped');
                  return;
                }
                onOpen(value as PreferenceKey);
              }}
            />
          </Box>
          <Box marginTop={1}>
            {/* Select styles its own option labels, so the rows carry the state
                as a symbol and only this legend can be colored. */}
            <Text dimColor>{`${MARKER.default} default   `}</Text>
            <Text color={PALETTE.info}>{MARKER.changed}</Text>
            <Text dimColor> changed</Text>
          </Box>
        </Box>
      }
    >
      {null}
    </StepLayout>
  );
}
