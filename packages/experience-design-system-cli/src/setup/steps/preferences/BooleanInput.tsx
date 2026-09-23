import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Select } from '@inkjs/ui';
import {
  readExperiencesCredentials,
  writeExperiencesCredentials,
  type ExperiencesCredentials,
} from '../../../credentials-store.js';
import { StepLayout, type StepDone } from '../StepLayout.js';

type BooleanPreferenceProps = {
  helpText: string;
  question: string;
  /** What choosing each option means, named after the outcome rather than yes/no. */
  labels: { on: string; off: string };
  /** Reads the stored value; `undefined` means the operator has never set it. */
  read: (credentials: ExperiencesCredentials) => boolean | undefined;
  /** Applied to the stored credentials when the answer differs from the default. */
  write: (credentials: ExperiencesCredentials, value: boolean) => ExperiencesCredentials;
  /** What the setting means when it has never been set. */
  fallback: boolean;
  onDone: StepDone;
};

export function BooleanInput({
  helpText,
  question,
  labels,
  read,
  write,
  fallback,
  onDone,
}: BooleanPreferenceProps): React.ReactElement {
  const [stored, setStored] = useState<ExperiencesCredentials | null>(null);

  useEffect(() => {
    void readExperiencesCredentials().then(setStored);
  }, []);

  if (!stored) return <Text dimColor>Reading saved preferences…</Text>;

  const current = read(stored) ?? fallback;

  const submit = (value: boolean): void => {
    if (value === current) {
      onDone('skipped');
      return;
    }
    void writeExperiencesCredentials(write(stored, value)).then(() => onDone('completed'));
  };

  return (
    <StepLayout
      helpText={helpText}
      prompt={
        <Box flexDirection="column">
          <Text>{question}</Text>
          <Box marginTop={1}>
            <Select
              options={
                current
                  ? [
                      { label: labels.on, value: 'on' },
                      { label: labels.off, value: 'off' },
                    ]
                  : [
                      { label: labels.off, value: 'off' },
                      { label: labels.on, value: 'on' },
                    ]
              }
              onChange={(value) => submit(value === 'on')}
            />
          </Box>
        </Box>
      }
    />
  );
}
