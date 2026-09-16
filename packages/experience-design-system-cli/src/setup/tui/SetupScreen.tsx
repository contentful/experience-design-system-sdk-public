import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { PALETTE } from '../../analyze/select/tui/theme.js';
import {
  SETUP_TITLE,
  countRequiredFailures,
  formatSetupCompletionMessage,
  setupScreenLabel,
  shouldAlignVersionRight,
  type SetupResultEntry,
} from '../screen.js';
import { splitPromptInput } from '../prompt-input.js';
import { usePromptInput } from './usePromptInput.js';
import { SetupStepper } from './SetupStepper.js';
import {
  runAgentSetup,
  runCredentialsSetup,
  runPreferenceSetupAction,
  runPrerequisitesSetup,
  type SetupActionDependencies,
  type SetupActionEvent,
} from '../setup-actions.js';

/** The dependencies the screen cannot supply itself; prompts and output are UI-owned. */
export type SetupScreenDependencies = Omit<SetupActionDependencies, 'ask' | 'askSecret' | 'confirm' | 'write'>;

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
  dependencies: SetupScreenDependencies;
  skip?: SetupSkipFlags;
  /** Terminal width override; defaults to the live Ink stdout columns. */
  columns?: number;
  /** Whether to offer `experiences doctor` after the summary. */
  offerDoctor?: boolean;
  onComplete: (outcome: SetupOutcome) => void;
};

type PendingPrompt =
  | { kind: 'text' | 'secret'; question: string; resolve: (answer: string) => void }
  | { kind: 'confirm'; question: string; defaultYes: boolean; resolve: (answer: boolean) => void };

const STEP_ACTIVITY = [
  'Checking prerequisites',
  'Configuring your coding agent',
  'Configuring Contentful credentials',
  'Configuring preferences',
] as const;

export function SetupScreen({
  version,
  repoRoot,
  profilePath,
  dependencies,
  skip = {},
  columns: columnsOverride,
  offerDoctor = false,
  onComplete,
}: SetupScreenProps): React.ReactElement {
  const { stdout } = useStdout();
  const columns = columnsOverride ?? stdout?.columns;

  const [activeStep, setActiveStep] = useState(1);
  const [events, setEvents] = useState<SetupActionEvent[]>([]);
  const [prompt, setPrompt] = useState<PendingPrompt | null>(null);
  const [inputValue, setInputValue] = useState('');
  // A single chunk can carry typed text and the Enter that submits it, so the
  // value has to be readable synchronously rather than via batched state.
  const inputValueRef = useRef('');

  const updateInput = (next: string): void => {
    inputValueRef.current = next;
    setInputValue(next);
  };
  const [outcome, setOutcome] = useState<SetupOutcome | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The driver mounts once and awaits the UI for every prompt, so the actions
  // keep their existing sequencing without knowing they are rendered by Ink.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const request = <T,>(build: (resolve: (answer: T) => void) => PendingPrompt): Promise<T> =>
      new Promise<T>((resolve) => {
        updateInput('');
        setPrompt(build(resolve));
      });

    const uiDependencies: SetupActionDependencies = {
      ...dependencies,
      ask: (question) => request<string>((resolve) => ({ kind: 'text', question, resolve })),
      askSecret: (question) => request<string>((resolve) => ({ kind: 'secret', question, resolve })),
      confirm: (question, defaultYes = true) =>
        request<boolean>((resolve) => ({ kind: 'confirm', question, defaultYes, resolve })),
      write: (event) => setEvents((current) => [...current, event]),
    };

    const enterStep = (step: number): void => {
      setActiveStep(step);
      setEvents([]);
    };

    void (async () => {
      const results: SetupResultEntry[] = [];

      // Step 1 — prerequisites run immediately, without waiting for input.
      const prerequisites = await runPrerequisitesSetup(uiDependencies, repoRoot, {
        ...(skip.skipBuild !== undefined ? { skipBuild: skip.skipBuild } : {}),
      });
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
          name: 'install & build',
          status: prerequisites.build.passed ? 'completed' : 'failed',
          required: true,
        });
      } else if (skip.skipBuild) {
        results.push({ name: 'install & build', status: 'skipped', required: false });
      }

      // Step 2 — coding agent.
      enterStep(2);
      if (skip.skipAgent) {
        results.push({ name: 'coding agent', status: 'skipped', required: false });
      } else {
        const { agent, agentModel, passed } = await runAgentSetup(uiDependencies);
        if (agent) {
          const stored = await dependencies.readCredentials();
          const { agentModel: _staleModel, ...storedWithoutModel } = stored;
          await dependencies.writeCredentials({
            ...storedWithoutModel,
            agent,
            ...(agentModel ? { agentModel } : {}),
          });
        }
        results.push({ name: 'coding agent', status: passed ? 'completed' : 'failed', required: true });
      }

      // Step 3 — Contentful credentials.
      enterStep(3);
      if (skip.skipCredentials) {
        results.push({ name: 'Contentful credentials', status: 'skipped', required: false });
      } else {
        const credentials = await runCredentialsSetup(uiDependencies);
        results.push({
          name: 'Contentful credentials',
          status: credentials.passed ? 'completed' : 'failed',
          required: false,
        });
      }

      // Step 4 — preferences.
      enterStep(4);
      if (skip.skipOptional) {
        results.push({ name: 'Preferences', status: 'skipped', required: false });
      } else {
        const { selected } = await runPreferenceSetupAction(uiDependencies, profilePath);
        results.push({
          name: 'Preferences',
          status: selected.length > 0 ? 'completed' : 'skipped',
          required: false,
        });
      }

      const exitCode = countRequiredFailures(results) === 0 ? 0 : 1;
      setPrompt(null);
      setEvents([]);
      setOutcome({ results, exitCode, restartRequired: false, runDoctor: false });

      const runDoctor = offerDoctor
        ? await request<boolean>((resolve) => ({
            kind: 'confirm',
            question: 'Run experiences doctor now to verify your environment?',
            defaultYes: exitCode === 0,
            resolve,
          }))
        : false;

      setPrompt(null);
      const finalOutcome: SetupOutcome = { results, exitCode, restartRequired: false, runDoctor };
      setOutcome(finalOutcome);
      onComplete(finalOutcome);
    })();
    // Deliberately keyed on nothing: the driver owns the whole run, so
    // re-running it when a prop changes identity would restart setup
    // mid-flight. `startedRef` guards against a double invocation.
  }, []);

  usePromptInput((chunk, key) => {
    const active = prompt;
    if (!active) return;

    const submit = (value: string): void => {
      setPrompt(null);
      updateInput('');
      if (active.kind === 'confirm') {
        const answer = value.trim().toLowerCase();
        active.resolve(answer === '' ? active.defaultYes : answer.startsWith('y'));
      } else {
        active.resolve(value.trim());
      }
    };

    if (key.return) {
      submit(inputValueRef.current);
      return;
    }

    if (key.backspace || key.delete) {
      updateInput(inputValueRef.current.slice(0, -1));
      return;
    }

    if (key.ctrl || key.meta || key.escape || key.tab) return;

    // Pasted values arrive as one chunk that may already include the Enter
    // that submits them, so the raw chunk is split rather than appended whole.
    const { text, submitted } = splitPromptInput(chunk);
    if (!text && !submitted) return;
    const next = inputValueRef.current + text;
    if (submitted) submit(next);
    else updateInput(next);
  });

  const versionLabel = `v${version}`;
  const alignRight = shouldAlignVersionRight(version, columns);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold>{SETUP_TITLE}</Text>
        {alignRight ? <Box flexGrow={1} /> : <Text> </Text>}
        <Text dimColor>{versionLabel}</Text>
      </Box>
      <Text>
        Prepare this machine for <Text bold>experiences import</Text>.
      </Text>

      <Box marginTop={1}>
        <SetupStepper activeStep={activeStep} columns={columns} />
      </Box>

      {outcome ? (
        <SetupSummary outcome={outcome} notice={notice} />
      ) : (
        <>
          <Box marginTop={1}>
            <Text dimColor>{setupScreenLabel(activeStep)}</Text>
          </Box>
          <SetupEventLog events={events} />
          {!prompt && (
            <Box marginTop={1}>
              <Text color={PALETTE.info}>⟳ {STEP_ACTIVITY[activeStep - 1]}…</Text>
            </Box>
          )}
        </>
      )}

      {prompt && <SetupPrompt prompt={prompt} value={inputValue} />}
    </Box>
  );
}

function SetupEventLog({ events }: { events: readonly SetupActionEvent[] }): React.ReactElement | null {
  if (events.length === 0) return null;

  return (
    <Box flexDirection="column" marginTop={1}>
      {events.map((event, index) => (
        <SetupEventLine key={`${index}-${event.message}`} event={event} />
      ))}
    </Box>
  );
}

function SetupEventLine({ event }: { event: SetupActionEvent }): React.ReactElement {
  if (event.kind === 'success') return <Text color={PALETTE.success}>✓ {event.message}</Text>;
  if (event.kind === 'failure') return <Text color={PALETTE.error}>✗ {event.message}</Text>;
  if (event.kind === 'warning') return <Text color={PALETTE.warning}>⚠ {event.message}</Text>;
  if (event.kind === 'dim') return <Text dimColor>{event.message}</Text>;
  if (event.kind === 'choice') return <Text> {event.message}</Text>;
  return <Text>{event.message}</Text>;
}

function SetupPrompt({ prompt, value }: { prompt: PendingPrompt; value: string }): React.ReactElement {
  const display = prompt.kind === 'secret' ? '•'.repeat(value.length) : value;
  const hint = prompt.kind === 'confirm' ? (prompt.defaultYes ? ' [Y/n]' : ' [y/N]') : '';

  return (
    <Box marginTop={1}>
      <Text color={PALETTE.info}>› </Text>
      <Text>
        {prompt.question}
        {hint}
      </Text>
      <Text> {display}</Text>
      <Text color={PALETTE.info}>█</Text>
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
