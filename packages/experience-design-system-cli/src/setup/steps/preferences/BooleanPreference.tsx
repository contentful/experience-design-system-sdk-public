import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { ConfirmInput } from '@inkjs/ui';
import {
  readExperiencesCredentials,
  writeExperiencesCredentials,
  type ExperiencesCredentials,
} from '../../../credentials-store.js';
import { StepLayout, type StepDone } from '../StepLayout.js';

type BooleanPreferenceProps = {
  help: string;
  question: string;
  /** Reads the stored value; `undefined` means the operator has never set it. */
  read: (credentials: ExperiencesCredentials) => boolean | undefined;
  /** Applied to the stored credentials when the answer differs from the default. */
  write: (credentials: ExperiencesCredentials, value: boolean) => ExperiencesCredentials;
  /** What the setting means when it has never been set. */
  fallback: boolean;
  onDone: StepDone;
};

/**
 * The three boolean preferences differ only in their wording and which field
 * they persist, so they share one screen. An answer matching the current value
 * writes nothing, which is what makes pressing Enter through the wizard safe.
 */
export function BooleanPreference({
  help,
  question,
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
      help={help}
      prompt={
        <Box>
          <Text>{question} </Text>
          <ConfirmInput
            defaultChoice={current ? 'confirm' : 'cancel'}
            onConfirm={() => submit(true)}
            onCancel={() => submit(false)}
          />
        </Box>
      }
    >
      {null}
    </StepLayout>
  );
}
