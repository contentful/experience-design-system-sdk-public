import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Select } from '@inkjs/ui';
import { readExperiencesCredentials, type ExperiencesCredentials } from '../../../credentials-store.js';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { StepLayout, type StepDone } from '../StepLayout.js';
import { PREFERENCE_OPTIONS, type PreferenceKey } from './index.js';

/** The value the trailing row reports; no PreferenceKey contains a colon. */
const DONE_VALUE = 'menu:done';

/** Spaces between the longest preference name and the current-value column. */
const VALUE_GAP = 6;

export const PREFERENCES_MENU_HELP = 'Every preference already has a working default — open one only to change it.';

/** What each preference currently resolves to, for the menu's summary column. */
export type PreferenceSummary = Record<PreferenceKey, string>;

type PreferencesMenuProps = {
  /** Preferences changed so far this visit; decides what Done reports. */
  changed: ReadonlySet<PreferenceKey>;
  onOpen: (key: PreferenceKey) => void;
  onDone: StepDone;
};

/**
 * Describe each preference the way the operator reads it, so a row says what the
 * setting currently does rather than which field stores it.
 */
export function summarisePreferences(credentials: ExperiencesCredentials): PreferenceSummary {
  return {
    autoFilter: (credentials.autoFilter ?? true) ? 'Filtering out irrelevant components' : 'Keeping every component',
    customPrompts: describeCustomPrompts(credentials),
    debug: (credentials.debug ?? false) ? 'Verbose traces' : 'Quiet',
    analytics: (credentials.analyticsDisabled ?? false) ? 'Not sharing usage data' : 'Sharing usage data',
    noColor: (credentials.noColor ?? false) ? 'Colors off' : 'Colors on',
  };
}

function describeCustomPrompts(credentials: ExperiencesCredentials): string {
  const count = [credentials.selectPromptPath, credentials.generatePromptPath].filter(Boolean).length;
  if (count === 0) return 'Built-in prompts';
  return count === 2 ? 'Custom select and generate' : 'One custom prompt';
}

/**
 * The preferences step opens here instead of walking every setting, so the
 * operator reads the current values and opens only what they want to change.
 */
export function PreferencesMenu({ changed, onOpen, onDone }: PreferencesMenuProps): React.ReactElement {
  const [summary, setSummary] = useState<PreferenceSummary | null>(null);

  const load = useCallback(
    async (): Promise<PreferenceSummary> => summarisePreferences(await readExperiencesCredentials()),
    [],
  );

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
    // Select renders a label node as-is, so the current value keeps its own
    // muted color even on the focused row, where the label wrapper is blue.
    ...PREFERENCE_OPTIONS.map((option) => ({
      label: (
        <Text>
          {option.label.padEnd(labelWidth + VALUE_GAP)}
          <Text color={PALETTE.muted}>{summary[option.key]}</Text>
        </Text>
      ) as unknown as string,
      value: option.key as string,
    })),
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
        </Box>
      }
    >
      {null}
    </StepLayout>
  );
}
