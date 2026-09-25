import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Select } from '@inkjs/ui';
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

/** The value the trailing row reports; no PreferenceKey contains a colon. */
const DONE_VALUE = 'menu:done';

const PREFERENCES_MENU_HELP = 'Every preference already has a working default — open one to change it.';

type PreferenceListProps = {
  /** Preferences changed so far this visit; decides what Done reports. */
  changed: ReadonlySet<PreferenceKey>;
  onOpen: (key: PreferenceKey) => void;
  onDone: StepDone;
};
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
  const [pick, setPick] = useState(0);

  const options = [
    ...PREFERENCE_OPTIONS.map((option) => ({ label: option.label, value: option.key as string })),
    { label: 'Done', value: DONE_VALUE },
  ];

  return (
    <StepLayout
      helpText={PREFERENCES_MENU_HELP}
      prompt={
        <Box flexDirection="column">
          <Text>Preferences</Text>
          <Box marginTop={1}>
            <Select
              key={pick}
              options={options}
              visibleOptionCount={options.length}
              onChange={(value) => {
                setPick((count) => count + 1);
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
