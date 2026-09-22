import React, { useEffect, useState } from 'react';
import { cpus } from 'node:os';
import { Box, Text } from 'ink';
import { Select } from '@inkjs/ui';
import {
  readExperiencesCredentials,
  writeExperiencesCredentials,
  type ExperiencesCredentials,
} from '../../../credentials-store.js';
import { StepLayout, type StepDone } from '../StepLayout.js';

export const CONCURRENCY_HELP = 'Analyzes more components at once, which is faster on machines with spare cores.';

/** What the extractor uses when the operator has not chosen a value. */
export const DEFAULT_LABEL = 'One per CPU core';

const BOOSTED = 8;

/** The value Select reports for leaving the setting alone. */
const KEEP = 'keep';

/**
 * Files to extract at once. Stored in the credentials file rather than the shell
 * profile: it is our own setting, and a profile export would not reach a Windows
 * shell. The extractor reads `EDS_EXTRACT_CONCURRENCY` from the environment,
 * which the CLI fills in from this value while starting up, so an operator who
 * exports it themselves still wins.
 */
export function ConcurrencyScreen({ onDone }: { onDone: StepDone }): React.ReactElement {
  const [stored, setStored] = useState<ExperiencesCredentials | null>(null);

  useEffect(() => {
    void readExperiencesCredentials().then(setStored);
  }, []);

  if (!stored) return <Text dimColor>Reading saved preferences…</Text>;

  const current = stored.extractConcurrency;
  const cores = cpus().length;

  const submit = (value: number | undefined): void => {
    if (value === current) {
      onDone('skipped');
      return;
    }
    const next = { ...stored };
    if (value === undefined) delete next.extractConcurrency;
    else next.extractConcurrency = value;
    void writeExperiencesCredentials(next).then(() => onDone('completed'));
  };

  // The current setting leads the list, so pressing Enter keeps it: Select
  // highlights its first option and reports whatever the operator submits.
  const perCore = { label: `${DEFAULT_LABEL} (${cores} here)`, value: KEEP };
  const boosted = { label: `Extract ${BOOSTED} files at once`, value: String(BOOSTED) };
  const options =
    current === undefined
      ? [perCore, boosted]
      : [{ label: `Keep ${current} files at once`, value: String(current) }, perCore];

  return (
    <StepLayout
      helpText={CONCURRENCY_HELP}
      prompt={
        <Box flexDirection="column">
          <Text>Performance concurrency</Text>
          <Box marginTop={1}>
            <Select options={options} onChange={(value) => submit(value === KEEP ? undefined : Number(value))} />
          </Box>
        </Box>
      }
    >
      {null}
    </StepLayout>
  );
}
