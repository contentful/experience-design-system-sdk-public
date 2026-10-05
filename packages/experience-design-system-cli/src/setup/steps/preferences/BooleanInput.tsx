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

function tick(labels: { on: string; off: string }, forOn: boolean, current: boolean): string {
  const label = forOn ? labels.on : labels.off;
  return forOn === current ? `${label} ✓` : label;
}

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
              options={[
                // The value in effect leads and carries the tick, so the operator
                // sees what is set now without the menu having to report it.
                { label: tick(labels, current, current), value: current ? 'on' : 'off' },
                { label: tick(labels, !current, current), value: current ? 'off' : 'on' },
              ]}
              onChange={(value) => submit(value === 'on')}
            />
          </Box>
        </Box>
      }
    />
  );
}
