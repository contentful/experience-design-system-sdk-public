import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { ConfirmInput } from '@inkjs/ui';
import { appendToProfile, profileContains } from '../../lib/shell.js';
import { StepLayout, StepSuccess, type StepDone } from '../StepLayout.js';

type ProfilePreferenceProps = {
  help: string;
  question: string;
  /** The variable to look for before offering to add it. */
  variable: string;
  /** The lines appended to the shell profile on confirmation. */
  lines: string;
  profilePath: string;
  onDone: StepDone;
};

/**
 * A preference stored in the operator's shell profile rather than the
 * credentials file. Already-present variables are left alone rather than
 * appended twice.
 */
export function ProfilePreference({
  help,
  question,
  variable,
  lines,
  profilePath,
  onDone,
}: ProfilePreferenceProps): React.ReactElement {
  const [present, setPresent] = useState<boolean | null>(null);

  useEffect(() => {
    void profileContains(profilePath, variable).then((found) => {
      setPresent(found);
      if (found) onDone('skipped');
    });
  }, [profilePath, variable, onDone]);

  if (present === null) return <Text dimColor>Checking your shell profile…</Text>;
  if (present) return <StepSuccess>{`${variable} — already set`}</StepSuccess>;

  return (
    <StepLayout
      help={help}
      prompt={
        <Box>
          <Text>{question} </Text>
          <ConfirmInput
            defaultChoice="cancel"
            onConfirm={() => void appendToProfile(profilePath, lines).then(() => onDone('completed'))}
            onCancel={() => onDone('skipped')}
          />
        </Box>
      }
    >
      {null}
    </StepLayout>
  );
}
