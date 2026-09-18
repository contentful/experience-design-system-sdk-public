import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { Select } from '@inkjs/ui';
import { appendToProfile, profileContains } from '../../lib/shell.js';
import { StepLayout, StepSuccess, type StepDone } from '../StepLayout.js';

type ProfilePreferenceProps = {
  helpText: string;
  question: string;
  /** What choosing each option means, named after the outcome rather than yes/no. */
  labels: { add: string; skip: string };
  /** The variable to look for before offering to add it. */
  variable: string;
  /** The lines appended to the shell profile on confirmation. */
  lines: string;
  profilePath: string;
  onDone: StepDone;
};

const ADD = 'add';
const SKIP = 'skip';

/**
 * A preference stored in the operator's shell profile rather than the
 * credentials file. Already-present variables are left alone rather than
 * appended twice, and leaving the setting alone starts highlighted.
 */
export function ProfilePreference({
  helpText,
  question,
  labels,
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
      helpText={helpText}
      prompt={
        <Box flexDirection="column">
          <Text>{question}</Text>
          <Box marginTop={1}>
            <Select
              // Leaving the profile alone leads the list, since Select highlights
              // its first option and reports whatever the operator submits.
              options={[
                { label: labels.skip, value: SKIP },
                { label: labels.add, value: ADD },
              ]}
              onChange={(value) => {
                if (value === ADD) {
                  void appendToProfile(profilePath, lines).then(() => onDone('completed'));
                  return;
                }
                onDone('skipped');
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
