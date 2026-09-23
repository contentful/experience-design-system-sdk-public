import React, { useCallback, useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Select } from '@inkjs/ui';
import { readExperiencesCredentials, type ExperiencesCredentials } from '../../../credentials-store.js';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { StepLayout, type StepDone } from '../StepLayout.js';
import { AnalyticsScreen } from './AnalyticsScreen.js';
import { AutoFilterScreen } from './AutoFilterScreen.js';
import { ColorPreferenceScreen } from './ColorPreferenceScreen.js';
import { CustomPromptsScreen } from './CustomPromptScreen.js';
import { DebugLogsScreen } from './DebugLogsScreen.js';

type PreferenceScreenProps = {
  onDone: StepDone;
};

export const PREFERENCE_OPTIONS = [
  {
    key: 'autoFilter',
    label: 'AI auto-filter',
    Screen: ({ onDone }: PreferenceScreenProps) => <AutoFilterScreen onDone={onDone} />,
  },
  {
    key: 'customPrompts',
    label: 'Custom prompts',
    Screen: ({ onDone }: PreferenceScreenProps) => <CustomPromptsScreen onDone={onDone} />,
  },
  {
    key: 'debug',
    label: 'Debug logging',
    Screen: ({ onDone }: PreferenceScreenProps) => <DebugLogsScreen onDone={onDone} />,
  },
  {
    key: 'analytics',
    label: 'Usage analytics',
    Screen: ({ onDone }: PreferenceScreenProps) => <AnalyticsScreen onDone={onDone} />,
  },
  {
    key: 'noColor',
    label: 'Terminal colors',
    Screen: ({ onDone }: PreferenceScreenProps) => <ColorPreferenceScreen onDone={onDone} />,
  },
] as const;

type PreferenceKey = (typeof PREFERENCE_OPTIONS)[number]['key'];

\const DONE_VALUE = 'menu:done';

const PREFERENCES_MENU_HELP = 'Every preference already has a working default — open one to change it.';

type PreferenceSummary = Record<PreferenceKey, string>;

type PreferenceListProps = {
  changed: ReadonlySet<PreferenceKey>;
  onOpen: (key: PreferenceKey) => void;
  onDone: StepDone;
};


export function summarisePreferences(credentials: ExperiencesCredentials): PreferenceSummary {
  return {
    autoFilter: (credentials.autoFilter ?? true) ? 'filtering out irrelevant components' : 'keeping every component',
    customPrompts: describeCustomPrompts(credentials),
    debug: (credentials.debug ?? false) ? 'verbose traces' : 'quiet',
    analytics: (credentials.analyticsDisabled ?? false) ? 'not sharing usage data' : 'sharing usage data',
    noColor: (credentials.noColor ?? false) ? 'colors off' : 'colors on',
  };
}

function describeCustomPrompts(credentials: ExperiencesCredentials): string {
  const count = [credentials.selectPromptPath, credentials.generatePromptPath].filter(Boolean).length;
  if (count === 0) return 'built-in prompts';
  return count === 2 ? 'custom select and generate' : 'one custom prompt';
}

export function PreferencesMenu({ onDone }: { onDone: StepDone }): React.ReactElement {
  const [open, setOpen] = useState<PreferenceKey | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<PreferenceKey>>(new Set());

  const entry = open === null ? undefined : PREFERENCE_OPTIONS.find((option) => option.key === open);
  if (!entry) return <PreferenceList changed={changed} onOpen={setOpen} onDone={onDone} />;

  const { key, Screen } = entry;
  return (
    <Screen
      key={key}
      onDone={(status) => {
        if (status === 'completed') setChanged((current) => new Set(current).add(key));
        setOpen(null);
      }}
    />
  );
}

function PreferenceList({ changed, onOpen, onDone }: PreferenceListProps): React.ReactElement {
  const [summary, setSummary] = useState<PreferenceSummary | null>(null);

  const load = useCallback(
    async (): Promise<PreferenceSummary> => summarisePreferences(await readExperiencesCredentials()),
    [],
  );

  // The menu unmounts this list while a preference screen is open, so mounting is
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

  const options = [
    ...PREFERENCE_OPTIONS.map((option) => ({
      label: (
        <Text>
          {option.label}
          <Text color={PALETTE.muted}> — {summary[option.key]}</Text>
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
    />
  );
}
