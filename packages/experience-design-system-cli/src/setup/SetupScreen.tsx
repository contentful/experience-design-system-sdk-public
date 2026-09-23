import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { ConfirmInput } from '@inkjs/ui';
import { PALETTE } from '../analyze/select/tui/theme.js';
import {
  SETUP_TITLE,
  countRequiredFailures,
  formatSetupCompletionMessage,
  shouldAlignVersionRight,
  type SetupResultEntry,
} from './lib/layout.js';
import { SetupStepper } from './SetupStepper.js';
import { CodingAgentScreen } from './steps/coding-agent.js';
import { ContentfulScreen } from './steps/contentful-credentials.js';
import type { StepStatus } from './steps/StepLayout.js';
import { PreferencesStep } from './steps/preferences/PreferencesStep.js';
import { PrerequisitesScreen } from './steps/prerequisites/PrerequisitesScreen.js';
import type { PrerequisitesOutcome } from './steps/prerequisites/deps.js';

/** Prompts and output are UI-owned; the screen supplies the rest itself. */
export type SetupSkipFlags = {
  skipBuild?: boolean;
  skipAgent?: boolean;
  skipCredentials?: boolean;
  skipOptional?: boolean;
};

export type SetupOutcome = {
  results: SetupResultEntry[];
  exitCode: number;
  restartRequired: boolean;
  runDoctor: boolean;
};

type SetupScreenProps = {
  version: string;
  repoRoot: string;
  profilePath: string;
  skip?: SetupSkipFlags;
  /** Defaults to the live Ink stdout columns. */
  columns?: number;
  offerDoctor?: boolean;
  onComplete: (outcome: SetupOutcome) => void;
};

type PendingConfirm = {
  question: string;
  defaultYes: boolean;
  resolve: (answer: boolean) => void;
};

export function SetupScreen({
  version,
  repoRoot,
  profilePath,
  skip = {},
  columns: columnsOverride,
  offerDoctor = false,
  onComplete,
}: SetupScreenProps): React.ReactElement {
  const { stdout } = useStdout();
  const columns = columnsOverride ?? stdout?.columns;

  const [activeStep, setActiveStep] = useState(1);
  const [prompt, setPrompt] = useState<PendingConfirm | null>(null);
  const [outcome, setOutcome] = useState<SetupOutcome | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // A step that owns its own screen renders here while the driver awaits it.
  const [screen, setScreen] = useState<React.ReactNode | null>(null);

  // The driver awaits the UI for every prompt, so the actions keep their own
  // sequencing without knowing they are rendered by Ink.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    /**
     * Hand the terminal to a self-rendering step and resolve with what it reports.
     * The finished step stays on screen until the next one replaces it — clearing
     * it first left a frame with nothing under the stepper, which read as a flicker.
     */
    const runScreen = <T,>(build: (done: (result: T) => void) => React.ReactNode): Promise<T> =>
      new Promise<T>((resolve) => {
        setPrompt(null);
        setScreen(build(resolve));
      });

    const enterStep = (step: number): void => {
      setActiveStep(step);
    };

    void (async () => {
      const results: SetupResultEntry[] = [];

      const prerequisites = await runScreen<PrerequisitesOutcome>((done) => (
        <PrerequisitesScreen
          repoRoot={repoRoot}
          {...(skip.skipBuild !== undefined ? { skipBuild: skip.skipBuild } : {})}
          onDone={done}
        />
      ));
      results.push({
        name: 'Node.js 24+',
        status: prerequisites.node.passed ? 'completed' : 'failed',
        required: true,
      });

      if (!prerequisites.node.passed) {
        setNotice('Node.js setup requires a shell restart. Re-run experiences setup afterwards.');
        const restartOutcome: SetupOutcome = {
          results,
          exitCode: 0,
          restartRequired: prerequisites.node.restartRequired ?? false,
          runDoctor: false,
        };
        setOutcome(restartOutcome);
        onComplete(restartOutcome);
        return;
      }

      results.push({ name: 'pnpm', status: prerequisites.pnpm?.passed ? 'completed' : 'failed', required: true });
      if (prerequisites.build) {
        results.push({
          name: 'Install & build',
          status: prerequisites.build.passed ? 'completed' : 'failed',
          required: true,
        });
      } else if (skip.skipBuild) {
        results.push({ name: 'Install & build', status: 'skipped', required: false });
      }

      enterStep(2);
      if (skip.skipAgent) {
        results.push({ name: 'Coding agent', status: 'skipped', required: false });
      } else {
        const status = await runScreen<StepStatus>((done) => <CodingAgentScreen onDone={done} />);
        results.push({ name: 'Coding agent', status, required: true });
      }

      enterStep(3);
      if (skip.skipCredentials) {
        results.push({ name: 'Contentful credentials', status: 'skipped', required: false });
      } else {
        const status = await runScreen<StepStatus>((done) => <ContentfulScreen onDone={done} />);
        results.push({ name: 'Contentful credentials', status, required: false });
      }

      enterStep(4);
      if (skip.skipOptional) {
        results.push({ name: 'Preferences', status: 'skipped', required: false });
      } else {
        // Preferences open on a menu rather than a forced walk: the operator
        // picks the ones they want and the step owns returning to the list.
        const status = await runScreen<StepStatus>((done) => (
          <PreferencesStep profilePath={profilePath} onDone={done} />
        ));
        results.push({ name: 'Preferences', status, required: false });
      }

      const exitCode = countRequiredFailures(results) === 0 ? 0 : 1;
      setPrompt(null);
      setOutcome({ results, exitCode, restartRequired: false, runDoctor: false });

      const runDoctor = offerDoctor
        ? await new Promise<boolean>((resolve) => {
            setPrompt({
              question: 'Run experiences doctor now to verify your environment?',
              defaultYes: exitCode === 0,
              resolve,
            });
          })
        : false;

      setPrompt(null);
      const finalOutcome: SetupOutcome = { results, exitCode, restartRequired: false, runDoctor };
      setOutcome(finalOutcome);
      onComplete(finalOutcome);
    })();
    // Keyed on nothing deliberately: re-running when a prop changes identity
    // would restart setup mid-flight.
  }, []);

  const versionLabel = `v${version}`;
  const alignRight = shouldAlignVersionRight(version, columns);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold>{SETUP_TITLE}</Text>
        {alignRight ? <Box flexGrow={1} /> : <Text> </Text>}
        <Text dimColor>{versionLabel}</Text>
      </Box>
      <Box marginTop={1}>
        <SetupStepper activeStep={activeStep} columns={columns} />
      </Box>

      {outcome ? <SetupSummary outcome={outcome} notice={notice} /> : screen && <Box marginTop={1}>{screen}</Box>}

      {prompt && (
        <Box marginTop={1}>
          <Text color={PALETTE.info}>› </Text>
          <Text>{prompt.question} </Text>
          <ConfirmInput
            defaultChoice={prompt.defaultYes ? 'confirm' : 'cancel'}
            onConfirm={() => {
              setPrompt(null);
              prompt.resolve(true);
            }}
            onCancel={() => {
              setPrompt(null);
              prompt.resolve(false);
            }}
          />
        </Box>
      )}
    </Box>
  );
}

function SetupSummary({ outcome, notice }: { outcome: SetupOutcome; notice: string | null }): React.ReactElement {
  const requiredFailed = countRequiredFailures(outcome.results);

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Summary</Text>
      {outcome.results.map((result) => {
        if (result.status === 'completed') {
          return (
            <Text key={result.name} color={PALETTE.success}>
              ✓ {result.name}
            </Text>
          );
        }
        if (result.status === 'skipped') {
          return (
            <Text key={result.name} dimColor>
              – {result.name} — skipped
            </Text>
          );
        }
        return (
          <Text key={result.name} color={result.required ? PALETTE.error : PALETTE.warning}>
            {result.required ? '✗' : '⚠'} {result.name} — {result.required ? 'required' : 'optional'}
          </Text>
        );
      })}

      {notice && (
        <Box marginTop={1}>
          <Text color={PALETTE.warning}>{notice}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text bold color={requiredFailed === 0 ? PALETTE.success : PALETTE.warning}>
          {formatSetupCompletionMessage(outcome.results)}
        </Text>
      </Box>
      {requiredFailed > 0 && <Text dimColor>Complete the steps above, then re-run experiences setup.</Text>}
    </Box>
  );
}
