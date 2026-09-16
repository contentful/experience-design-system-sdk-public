import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useStdout } from 'ink';
import { Select } from '@inkjs/ui';
import { PALETTE } from '../../analyze/select/tui/theme.js';
import {
  SETUP_TITLE,
  countRequiredFailures,
  formatSetupCompletionMessage,
  shouldAlignVersionRight,
  type SetupResultEntry,
} from '../lib/layout.js';
import { splitPromptInput } from '../lib/prompt-input.js';
import { usePromptInput } from './usePromptInput.js';
import { SetupStepper } from './SetupStepper.js';
import type { SetupActionDependencies, SetupActionEvent, SetupChoice } from '../lib/types.js';
import { runAgentSetup } from '../steps/coding-agent.js';
import { ContentfulScreen } from '../steps/contentful.js';
import type { StepStatus } from '../steps/StepLayout.js';
import { runPreferenceSetupAction } from '../steps/preferences/index.js';
import { runPrerequisitesSetup } from '../steps/prerequisites/index.js';

/** Prompts and output are UI-owned; the screen supplies the rest itself. */
export type SetupScreenDependencies = Omit<
  SetupActionDependencies,
  'ask' | 'askSecret' | 'confirm' | 'choose' | 'write'
>;

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
  /** Defaults to the live Ink stdout columns. */
  columns?: number;
  offerDoctor?: boolean;
  onComplete: (outcome: SetupOutcome) => void;
};

type PendingPrompt =
  | { kind: 'text' | 'secret'; question: string; resolve: (answer: string) => void }
  | { kind: 'confirm'; question: string; defaultYes: boolean; resolve: (answer: boolean) => void }
  | {
      kind: 'select';
      question: string;
      options: readonly SetupChoice[];
      resolve: (answer: number | undefined) => void;
    };

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
  const [pageHelp, setPageHelp] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  // A chunk can carry typed text and the Enter that submits it, so the value
  // has to be readable synchronously rather than through batched state.
  const inputValueRef = useRef('');

  const updateInput = (next: string): void => {
    inputValueRef.current = next;
    setInputValue(next);
  };
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

    const request = <T,>(build: (resolve: (answer: T) => void) => PendingPrompt): Promise<T> =>
      new Promise<T>((resolve) => {
        updateInput('');
        setPrompt(build(resolve));
      });

    /** Hand the terminal to a self-rendering step and resolve with its status. */
    const runScreen = (build: (done: (status: StepStatus) => void) => React.ReactNode): Promise<StepStatus> =>
      new Promise<StepStatus>((resolve) => {
        setPrompt(null);
        setPageHelp(null);
        setEvents([]);
        setScreen(
          build((status) => {
            setScreen(null);
            resolve(status);
          }),
        );
      });

    const uiDependencies: SetupActionDependencies = {
      ...dependencies,
      ask: (question) => request<string>((resolve) => ({ kind: 'text', question, resolve })),
      askSecret: (question) => request<string>((resolve) => ({ kind: 'secret', question, resolve })),
      confirm: (question, defaultYes = true) =>
        request<boolean>((resolve) => ({ kind: 'confirm', question, defaultYes, resolve })),
      choose: (question, options) =>
        request<number | undefined>((resolve) => ({ kind: 'select', question, options, resolve })),
      write: (event) => {
        if (event.kind === 'page') {
          setEvents([]);
          setPageHelp(event.message);
          return;
        }
        setEvents((current) => [...current, event]);
      },
    };

    const enterStep = (step: number): void => {
      setActiveStep(step);
      setEvents([]);
      setPageHelp(null);
    };

    void (async () => {
      const results: SetupResultEntry[] = [];

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
        results.push({ name: 'Coding agent', status: passed ? 'completed' : 'failed', required: true });
      }

      enterStep(3);
      if (skip.skipCredentials) {
        results.push({ name: 'Contentful credentials', status: 'skipped', required: false });
      } else {
        const status = await runScreen((done) => <ContentfulScreen onDone={done} />);
        results.push({ name: 'Contentful credentials', status, required: false });
      }

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
    // Keyed on nothing deliberately: re-running when a prop changes identity
    // would restart setup mid-flight.
  }, []);

  usePromptInput((chunk, key) => {
    const active = prompt;
    if (!active) return;

    // Select owns its own keys, so the raw handler ignores choice prompts.
    if (active.kind === 'select') return;

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
      <Box marginTop={1}>
        <SetupStepper activeStep={activeStep} columns={columns} />
      </Box>

      {outcome ? (
        <SetupSummary outcome={outcome} notice={notice} />
      ) : screen ? (
        <Box marginTop={1}>{screen}</Box>
      ) : (
        <>
          <SetupEventLog events={events} />
          {!prompt && (
            <Box marginTop={1}>
              <Text color={PALETTE.info}>⟳ {STEP_ACTIVITY[activeStep - 1]}…</Text>
            </Box>
          )}
        </>
      )}

      {prompt &&
        (prompt.kind === 'select' ? (
          <SetupChoiceList
            prompt={prompt}
            onResolve={(index) => {
              setPrompt(null);
              prompt.resolve(index);
            }}
          />
        ) : (
          <SetupPrompt prompt={prompt} value={inputValue} />
        ))}

      {pageHelp && !outcome && (
        <Box marginTop={1}>
          <Text dimColor>{pageHelp}</Text>
        </Box>
      )}
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
  // Ink gives an empty Text zero height, so a spacer needs a space to occupy.
  if (event.message === '') return <Text> </Text>;
  if (event.kind === 'success') return <Text color={PALETTE.success}>✓ {event.message}</Text>;
  if (event.kind === 'failure') return <Text color={PALETTE.error}>✗ {event.message}</Text>;
  if (event.kind === 'warning') return <Text color={PALETTE.warning}>⚠ {event.message}</Text>;
  if (event.kind === 'help') return <Text dimColor>{event.message}</Text>;
  if (event.kind === 'value') return <Text> {event.message}</Text>;
  return <Text>{event.message}</Text>;
}

/** The value Select reports when the operator picks the trailing Skip row. */
const SKIP_VALUE = '\u0000skip';

function SetupChoiceList({
  prompt,
  onResolve,
}: {
  prompt: Extract<PendingPrompt, { kind: 'select' }>;
  onResolve: (index: number | undefined) => void;
}): React.ReactElement {
  // Select keys options by value, so each row carries its index and Skip gets a
  // sentinel that cannot collide with one.
  const options = [
    ...prompt.options.map((option, index) => ({
      label: option.description ? `${option.label}  ${option.description}` : option.label,
      value: String(index),
    })),
    { label: 'Skip', value: SKIP_VALUE },
  ];

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text>{prompt.question}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Select
          options={options}
          visibleOptionCount={options.length}
          onChange={(value) => onResolve(value === SKIP_VALUE ? undefined : Number(value))}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑↓ to move · Enter to select</Text>
      </Box>
    </Box>
  );
}

function SetupPrompt({ prompt, value }: { prompt: PendingPrompt; value: string }): React.ReactElement {
  if (prompt.kind === 'select') return <Text>{prompt.question}</Text>;
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
