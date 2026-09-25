import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { ConfirmInput } from '@inkjs/ui';
import { PALETTE } from '../../../analyze/select/tui/theme.js';
import { binaryExists, pathExists, runSpawn } from '../../lib/shell.js';
import { StepLayout } from '../StepLayout.js';
import type { PrerequisiteDeps, PrerequisiteEvent, PrerequisitesOutcome } from './deps.js';
import { runPrerequisitesSetup } from './index.js';

export type PrerequisitesScreenProps = {
  repoRoot: string;
  skipBuild?: boolean;
  onDone: (outcome: PrerequisitesOutcome) => void;
  /** Injected so tests can drive the checks without spawning processes. */
  deps?: Pick<PrerequisiteDeps, 'nodeVersion' | 'homeDir' | 'binaryExists' | 'pathExists' | 'run'>;
};

type PendingConfirm = { question: string; defaultYes: boolean; resolve: (answer: boolean) => void };

function EventLine({ event }: { event: PrerequisiteEvent }): React.ReactElement {
  if (event.kind === 'success') return <Text color={PALETTE.success}>✓ {event.message}</Text>;
  if (event.kind === 'failure') return <Text color={PALETTE.error}>✗ {event.message}</Text>;
  if (event.kind === 'warning') return <Text color={PALETTE.warning}>⚠ {event.message}</Text>;
  return <Text>{event.message}</Text>;
}

/**
 * Prerequisites runs as soon as the wizard opens and reports each check as it
 * finishes. It keeps a driver rather than a per-question screen because the flow
 * is sequential — a failed check may offer an install, and the next check depends
 * on that answer.
 */
export function PrerequisitesScreen({
  repoRoot,
  skipBuild,
  onDone,
  deps,
}: PrerequisitesScreenProps): React.ReactElement {
  const [events, setEvents] = useState<PrerequisiteEvent[]>([]);
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const base = deps ?? {
      nodeVersion: process.versions.node,
      homeDir: process.env['HOME'] ?? '',
      binaryExists,
      pathExists,
      run: runSpawn,
    };

    const driver: PrerequisiteDeps = {
      ...base,
      emit: (event) => setEvents((current) => [...current, event]),
      confirm: (question, defaultYes = true) =>
        new Promise<boolean>((resolve) => {
          setConfirm({
            question,
            defaultYes,
            resolve: (answer) => {
              setConfirm(null);
              resolve(answer);
            },
          });
        }),
    };

    void runPrerequisitesSetup(driver, repoRoot, {
      ...(skipBuild !== undefined ? { skipBuild } : {}),
    }).then(onDone);
    // The driver owns the whole run; re-running it would restart the checks.
  }, []);

  return (
    <StepLayout
      prompt={
        confirm ? (
          <Box>
            <Text>{confirm.question} </Text>
            <ConfirmInput
              key={confirm.question}
              defaultChoice={confirm.defaultYes ? 'confirm' : 'cancel'}
              onConfirm={() => confirm.resolve(true)}
              onCancel={() => confirm.resolve(false)}
            />
          </Box>
        ) : (
          <Text color={PALETTE.info}>⟳ Checking prerequisites…</Text>
        )
      }
    >
      <Box flexDirection="column">
        {events.map((event, index) => (
          <EventLine key={`${index}-${event.message}`} event={event} />
        ))}
      </Box>
    </StepLayout>
  );
}
