import { useInput } from 'ink';
import React, { useEffect, useRef, useState } from 'react';
import { HomeScreen } from './src/tui/home/home.js';
import { ImportScreen } from './src/tui/import/PageContainer.js';
import {
  CredentialsScreen,
  ExtractionScreen,
  PathValidationScreen,
  PreflightScreen,
  TokenInputScreen,
  WelcomeScreen,
} from './src/tui/import/steps/index.js';
import {
  currentInputStep,
  goBack,
  runBaseDir,
  type ImportStepId,
  type ImportTarget,
  type InputAnswers,
} from './src/tui/import/steps/00-preflight/logic.js';
import { ErrorStep, RunningStep } from './src/tui/import/shared/index.js';
import { initialProgress, resolveAgentChoice } from './src/tui/import/steps/06-extraction/logic.js';
import { readSettings } from '@contentful/experience-design-system-types/config';
import { useExtraction } from './src/tui/import/steps/06-extraction/use-extraction.js';
import type { TokensOnlyInput } from './src/tui/import/steps/06-extraction/run-tokens-only.js';
import { useTokensOnly } from './src/tui/import/steps/06-extraction/use-tokens-only.js';
import { ScopeGateScreen } from './src/tui/import/steps/07-scope-gate/screen.js';
import { useScopeGateFlow } from './src/tui/import/steps/07-scope-gate/use-scope-gate-flow.js';
import { GenerationScreen } from './src/tui/import/steps/08-generation/screen.js';
import { useGeneration } from './src/tui/import/steps/08-generation/use-generation.js';
import type { GenerationInput } from './src/tui/import/steps/08-generation/types.js';
import type { ExtractionHandoff } from '@contentful/experience-design-system-types/handoff';
import type { ExtractionInput } from './src/tui/import/steps/06-extraction/types.js';
import { resolveUserPath } from './src/tui/import/resolve-user-path.js';
import type { CredentialsResult } from './src/tui/import/steps/04-credentials/screen.js';
import type { ImportOptions } from './src/commands/import-options.js';
import {
  assertDebugResumeStep,
  DEBUG_RESUME_STEPS,
  loadDebugResume,
  type DebugResumeState,
  type DebugResumeStep,
} from './src/tui/import/debug-resume.js';
import { DebugResumeScreen } from './src/tui/import/debug-resume-screen.js';
import { buildFlowStart } from './src/tui/import/steps/10-flow/flow/build-flow-start.js';
import type { FlowStart } from './src/tui/import/steps/10-flow/flow/controller.js';
import { FlowScreen } from './src/tui/import/steps/10-flow/flow/screen.js';
import { useFlow } from './src/tui/import/steps/10-flow/flow/use-flow.js';
import { HelpScreen } from './src/tui/help/PageContainer.js';
import { SettingsScreen } from './src/tui/settings/PageContainer.js';
import { ConfigurationScreen } from './src/tui/settings/configuration/ConfigurationScreen.js';
import { OptInAnalyticsScreen } from './src/tui/settings/opt-in-analytics/screen.js';
import { DebugModeScreen } from './src/tui/settings/debug-mode/screen.js';
import {
  readCredentials,
  writeCredentials,
  type V1Credentials,
} from './src/tui/settings/configuration/project/project-store.js';

import {
  awaitForCurrentImportAttempt,
  createImportAttemptOwner,
  isAbortError,
  trackImportWork,
  type ImportAttempt,
  type ImportAttemptOwner,
} from './src/tui/import/cancellation.js';

export type Screen =
  | 'start'
  | 'import'
  | 'help'
  | 'settings'
  | 'settings-configuration'
  | 'settings-opt-in-analytics'
  | 'settings-debug-mode';

/** What the import was started with: the paths the screens collected and the flags from the command line. */
interface ImportLaunch extends Partial<ImportOptions> {
  projectPath?: string;
  tokens?: string;
  filePaths?: string[];
  sourceInventory?: ExtractionInput['sourceInventory'];
}

interface ExtractionRun {
  attempt: ImportAttempt;
  launch: ImportLaunch;
  credentialsSkipped: boolean;
  input: ExtractionInput;
  /** A custom prompt for `generate components`, saved in the config. Read now, used when generation starts. */
  generatePromptPath?: string;
}

// Set when the import only generates tokens. There is no extraction, scope gate or generation: once the tokens exist the
// flow starts at saving.
interface TokensOnlyRun {
  attempt: ImportAttempt;
  credentialsSkipped: boolean;
  /** What the flow builds its start from (agent, credentials, project). It names no files: nothing is scanned. */
  input: ExtractionInput;
  tokens: TokensOnlyInput;
}

// Set once extraction has produced a session; the scope gate runs for it before the review starts.
interface ScopeRun {
  attempt: ImportAttempt;
  launch: ImportLaunch;
  credentialsSkipped: boolean;
  input: ExtractionInput;
  generatePromptPath?: string;
  extraction: ExtractionHandoff;
}

interface AppProps {
  importOptions: ImportOptions;
  inkClear: () => void;
}

function App({ importOptions, inkClear }: AppProps): React.ReactElement {
  const attemptOwnerRef = useRef<ImportAttemptOwner>();
  if (!attemptOwnerRef.current) attemptOwnerRef.current = createImportAttemptOwner();
  const attemptOwner = attemptOwnerRef.current;
  const beginAttempt = (): ImportAttempt => attemptOwner.begin();
  const cancelAttempt = (): void => attemptOwner.cancel();
  const isActiveAttempt = (attempt: ImportAttempt): boolean => attemptOwner.isCurrent(attempt);
  useEffect(() => () => cancelAttempt(), []);
  const [launchError, setLaunchError] = useState<{ stepName: string; message: string }>();
  const [preparing, setPreparing] = useState(false);
  const [sourceInventory, setSourceInventory] = useState<ExtractionInput['sourceInventory']>();
  const [screen, setScreen] = useState<Screen>(importOptions.debugResume ? 'import' : 'start');
  const [debugResumeState, setDebugResumeState] = useState<DebugResumeState>();
  const [debugResumeStep, setDebugResumeStep] = useState<DebugResumeStep>();
  const debugResumeStarted = useRef(false);
  // Set when the import has ended, with the exit code the result screen shows.
  const [importExitCode, setImportExitCode] = useState<number>();
  const showImportResult = importExitCode !== undefined;
  // What the user chose to generate, asked first. The screens after it are the ones that mode lists (00-preflight/logic).
  const [target, setTarget] = useState<ImportTarget>();
  // What the input screens have collected so far. The screen to show is the first one of the mode still unanswered.
  const [answers, setAnswers] = useState<InputAnswers>({});
  const answer = (patch: InputAnswers): void => setAnswers((current) => ({ ...current, ...patch }));
  // Set once credentials are done; the extraction stage runs for it before the legacy wizard starts.
  const [extractionRun, setExtractionRun] = useState<ExtractionRun>();
  const extraction = useExtraction(extractionRun?.input);
  const [tokensOnlyRun, setTokensOnlyRun] = useState<TokensOnlyRun>();
  const tokensOnly = useTokensOnly(tokensOnlyRun?.tokens);
  const [scopeRun, setScopeRun] = useState<ScopeRun>();
  const scopeFlow = useScopeGateFlow(
    scopeRun && {
      attemptId: scopeRun.attempt.id,
      signal: scopeRun.attempt.controller.signal,
      sessionId: scopeRun.extraction.sessionId,
      initialDecisions: debugResumeStep && debugResumeStep !== 'scope' ? debugResumeState?.decisions : undefined,
      cache: {
        sessionId: scopeRun.extraction.sessionId,
        tokensPath: scopeRun.extraction.tokensPath,
        agent: scopeRun.input.agent,
        ...(scopeRun.input.agentModel ? { agentModel: scopeRun.input.agentModel } : {}),
        promptOverrides: scopeRun.input.promptOverrides,
        existingEntitiesPath: scopeRun.extraction.existingEntitiesPath,
        noCache: scopeRun.input.noCache,
      },
    },
  );
  // The user's choices are made; generation runs for them before the legacy wizard starts.
  const [generationInput, setGenerationInput] = useState<GenerationInput>();
  const generation = useGeneration(generationInput);
  // Set once generation has finished; the review, save, preview and push run for it.
  const [flowStart, setFlowStart] = useState<FlowStart>();
  const flow = useFlow(flowStart, { beforeStepChange: inkClear });
  const [importDefaults, setImportDefaults] = useState<{
    componentDir: string;
    tokenFile: string;
    credentials: V1Credentials;
  }>();

  const startDebugResume = (state: DebugResumeState, step: DebugResumeStep): void => {
    assertDebugResumeStep(state, step);
    const attempt = beginAttempt();
    const { checkpoint } = state;
    const { agent, agentModel } = resolveAgentChoice(importOptions.agent, {
      agent: checkpoint.agent,
      agentModel: checkpoint.agentModel,
    });
    const input: ExtractionInput = {
      signal: attempt.controller.signal,
      projectPath: checkpoint.projectPath,
      outDir: checkpoint.extraction.outDir,
      filePaths: [],
      rawTokensPath: checkpoint.rawTokensPath,
      credentials: null,
      agent,
      ...(agentModel ? { agentModel } : {}),
      promptOverrides: importOptions.prompt.length ? importOptions.prompt : checkpoint.promptOverrides,
      noCache: true,
    };
    setDebugResumeStep(step);
    setTarget('components');
    if (step === 'review') {
      const generation = {
        route: 'review' as const,
        sessionId: checkpoint.extraction.sessionId,
        acceptedCount: state.decisions!.accepted.length,
        generatedCount: state.decisions!.accepted.length,
        mapTokensEligible: checkpoint.extraction.tokensPath !== '',
      };
      setFlowStart(
        buildFlowStart({
          extraction: input,
          handoff: {
            credentialsSkipped: true,
            tokens: { strategy: 'reuse' },
            extraction: checkpoint.extraction,
            generation,
          },
        }),
      );
    } else {
      setScopeRun({ attempt, launch: {}, credentialsSkipped: true, input, extraction: checkpoint.extraction });
    }
  };

  useEffect(() => {
    if (!importOptions.debugResume || !importDefaults || debugResumeStarted.current) return;
    debugResumeStarted.current = true;
    setPreparing(true);
    let disposed = false;
    void trackImportWork(
      (async () => {
        try {
          if (importOptions.debugFrom && !(DEBUG_RESUME_STEPS as readonly string[]).includes(importOptions.debugFrom))
            throw new Error(`Unknown debug step; choose ${DEBUG_RESUME_STEPS.join(', ')}.`);
          const settings = await readSettings();
          if (disposed) return;
          const { agent, agentModel } = resolveAgentChoice(importOptions.agent, settings);
          const state = await loadDebugResume(
            importOptions.debugResume!,
            importOptions.debugOutput
              ? {
                  outDir: resolveUserPath(importOptions.debugOutput),
                  agent,
                  agentModel,
                  promptOverrides: importOptions.prompt,
                }
              : undefined,
          );
          if (disposed) return;
          setDebugResumeState(state);
          if (importOptions.debugFrom) startDebugResume(state, importOptions.debugFrom as DebugResumeStep);
        } catch (error) {
          if (!disposed)
            setLaunchError({
              stepName: 'debug resume',
              message: error instanceof Error ? error.message : String(error),
            });
        } finally {
          if (!disposed) setPreparing(false);
        }
      })(),
    );
    return () => {
      disposed = true;
    };
  }, [importDefaults]);

  // Keep terminal input active when a running screen has no interactive controls.
  useInput(() => {});

  // Read the saved defaults each time the import flow opens, so a change in Settings shows up right away.
  // The screens only read their initial value on mount, so they wait for this to resolve.
  useEffect(() => {
    if (screen !== 'import') {
      setImportDefaults(undefined);
      return;
    }
    let disposed = false;
    setLaunchError(undefined);
    void readCredentials()
      .then((saved) => {
        if (disposed) return;
        setImportDefaults({
          componentDir: saved.defaultComponentDir ?? '',
          tokenFile: saved.defaultTokenFile ?? '',
          credentials: saved,
        });
      })
      .catch((error: unknown) => {
        if (!disposed)
          setLaunchError({
            stepName: 'load import settings',
            message: error instanceof Error ? error.message : String(error),
          });
      });
    return () => {
      disposed = true;
    };
  }, [screen]);

  const finishCredentials = async (result: CredentialsResult, collected: InputAnswers): Promise<void> => {
    const attempt = beginAttempt();
    setLaunchError(undefined);
    setPreparing(true);
    try {
      if (!result.skipped) {
        const saved = await awaitForCurrentImportAttempt(attempt, attemptOwner.isCurrent, () =>
          writeCredentials({ ...result.credentials }),
        );
        if (!saved.current) return;
      }
      const launch: ImportLaunch = {
        projectPath: runBaseDir({ ...collected, configuredBaseDir: importDefaults?.credentials.contentfulBaseDir }),
        tokens: collected.tokensPath ?? '',
        filePaths: collected.scannedFiles ?? [],
        sourceInventory,
        ...importOptions,
      };
      const settingsResult = await awaitForCurrentImportAttempt(attempt, attemptOwner.isCurrent, readSettings);
      if (!settingsResult.current) return;
      const settings = settingsResult.value;
      const { agent, agentModel } = resolveAgentChoice(launch.agent, settings);
      const generatePromptPath =
        typeof settings.generatePromptPath === 'string' ? settings.generatePromptPath : undefined;
      const debugResult = await awaitForCurrentImportAttempt(
        attempt,
        attemptOwner.isCurrent,
        () => import('./src/tui/debug-store.js'),
      );
      if (!debugResult.current) return;
      const directoryResult = await awaitForCurrentImportAttempt(attempt, attemptOwner.isCurrent, () =>
        debugResult.value.startImportRun(resolveUserPath(launch.projectPath ?? '')),
      );
      if (!directoryResult.current) return;
      const outDir = directoryResult.value;
      await debugResult.value.recordDebugEvent('import.prepare.completed', {
        attemptId: attempt.id,
        agent,
        target,
        fileCount: launch.filePaths?.length ?? 0,
      });
      if (!isActiveAttempt(attempt)) return;
      const input: ExtractionInput = {
        signal: attempt.controller.signal,
        projectPath: resolveUserPath(launch.projectPath ?? ''),
        outDir,
        filePaths: launch.filePaths ?? [],
        sourceInventory: launch.sourceInventory,
        rawTokensPath: launch.tokens ?? '',
        credentials: result.skipped ? null : result.credentials,
        agent,
        ...(agentModel ? { agentModel } : {}),
        promptOverrides: launch.prompt ?? [],
        noCache: launch.cache === false,
      };
      if (target === 'tokens') {
        setTokensOnlyRun({
          attempt,
          credentialsSkipped: result.skipped,
          input,
          tokens: {
            signal: attempt.controller.signal,
            rawTokensPath: input.rawTokensPath,
            outDir,
            agent,
            ...(agentModel ? { agentModel } : {}),
            promptOverrides: input.promptOverrides,
            noCache: input.noCache,
          },
        });
      } else {
        setExtractionRun({
          attempt,
          ...(generatePromptPath ? { generatePromptPath } : {}),
          launch: { ...launch, agent: agentModel ? `${agent}:${agentModel}` : agent },
          credentialsSkipped: result.skipped,
          input,
        });
      }
    } catch (error) {
      if (!isActiveAttempt(attempt)) return;
      cancelAttempt();
      if (!isAbortError(error))
        setLaunchError({ stepName: 'prepare import', message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (attemptOwner.current() === attempt || attemptOwner.current() === undefined) setPreparing(false);
    }
  };

  // Finished tokens start the flow at saving, once. There is no review: no components were generated.
  useEffect(() => {
    if (
      !tokensOnlyRun ||
      !isActiveAttempt(tokensOnlyRun.attempt) ||
      tokensOnly?.status !== 'done' ||
      !tokensOnly.result.ok
    )
      return;
    const { credentialsSkipped, input, tokens } = tokensOnlyRun;
    const { tokensPath, tokenSessionId, tokenCount } = tokensOnly.result;
    inkClear();
    setTokensOnlyRun(undefined);
    setFlowStart(
      buildFlowStart({
        extraction: input,
        saved: importDefaults?.credentials,
        handoff: { credentialsSkipped, tokens: { strategy: 'generate' } },
        tokensOnly: { tokensPath, tokenSessionId, tokenCount, outDir: tokens.outDir },
      }),
    );
  }, [tokensOnly, tokensOnlyRun]);

  // A finished extraction opens the scope gate, once, with what the stage produced.
  useEffect(() => {
    if (
      !extractionRun ||
      !isActiveAttempt(extractionRun.attempt) ||
      extraction?.status !== 'done' ||
      !extraction.result.ok
    )
      return;
    setExtractionRun(undefined);
    setScopeRun({ ...extractionRun, extraction: extraction.result.extraction });
  }, [extraction, extractionRun]);

  // A confirmed scope starts generation, once. The cache check that ran at the gate is handed over so generation can
  // wait for it before it saves the decisions.
  useEffect(() => {
    if (!scopeRun || !isActiveAttempt(scopeRun.attempt) || scopeFlow?.status !== 'confirmed' || generationInput) return;
    const { extraction: produced, input, generatePromptPath } = scopeRun;
    setGenerationInput({
      signal: scopeRun.attempt.controller.signal,
      sessionId: produced.sessionId,
      decisions: scopeFlow.decisions,
      cachedNames: scopeFlow.cachedNames,
      tokensPath: produced.tokensPath,
      tokenSessionId: produced.tokenSessionId,
      existingEntitiesPath: produced.existingEntitiesPath,
      agent: input.agent,
      ...(input.agentModel ? { agentModel: input.agentModel } : {}),
      promptOverrides: input.promptOverrides,
      noCache: input.noCache,
      hasTokens: produced.tokensPath !== '',
      ...(generatePromptPath ? { generatePromptPath } : {}),
      ...(debugResumeStep
        ? {
            debugResumeFrom:
              debugResumeStep === 'scope' ? 'details' : (debugResumeStep as 'details' | 'generation' | 'tokens'),
          }
        : {}),
    });
  }, [scopeFlow, scopeRun, generationInput]);

  // Finished generation starts the review and everything after it, exactly once, with everything the stages did.
  useEffect(() => {
    if (!scopeRun || !isActiveAttempt(scopeRun.attempt) || generation?.status !== 'done' || !generation.result.ok)
      return;
    const { credentialsSkipped, extraction: produced, input, generatePromptPath } = scopeRun;
    inkClear();
    setScopeRun(undefined);
    setGenerationInput(undefined);
    setFlowStart(
      buildFlowStart({
        extraction: input,
        saved: importDefaults?.credentials,
        handoff: {
          credentialsSkipped,
          tokens: { strategy: 'generate' },
          extraction: produced,
          generation: generation.result.generation,
        },
        generatePromptPath,
      }),
    );
  }, [generation, scopeRun]);

  const goToStart = (): void => setScreen('start');
  const goToSettings = (): void => setScreen('settings');

  const resetImport = (keepTarget = false): void => {
    cancelAttempt();
    setLaunchError(undefined);
    setPreparing(false);
    setSourceInventory(undefined);
    if (!keepTarget) setTarget(undefined);
    setAnswers({});
    setExtractionRun(undefined);
    setTokensOnlyRun(undefined);
    setScopeRun(undefined);
    setGenerationInput(undefined);
    setFlowStart(undefined);
    setDebugResumeState(undefined);
    setDebugResumeStep(undefined);
  };

  const finishImportResult = (): void => {
    setImportExitCode(undefined);
    resetImport();
    goToStart();
  };

  const leaveImport = (): void => {
    resetImport();
    goToStart();
  };

  // Back from a screen goes to the one before it in the chosen mode, which skips the screens the mode does not have.
  const goBackFrom = (current: ImportStepId): void => {
    if (!target) return;
    setSourceInventory(undefined);
    const back = goBack(target, current, answers);
    if (back.to === 'preflight') setTarget(undefined);
    else setAnswers(back.answers);
  };

  switch (screen) {
    case 'import':
      if (showImportResult) return <ImportScreen exitCode={importExitCode} onDone={finishImportResult} />;
      if (launchError)
        return <ErrorStep stepName={launchError.stepName} message={launchError.message} onExit={leaveImport} />;
      if (preparing)
        return <RunningStep step="extraction" description="Preparing settings and the import output folder." />;
      if (flow && flowStart) {
        return (
          <FlowScreen
            state={flow.state}
            controller={flow.controller}
            generatePromptPath={flowStart.generatePromptPath}
            onExit={setImportExitCode}
          />
        );
      }
      if (debugResumeState && !debugResumeStep)
        return (
          <DebugResumeScreen
            state={debugResumeState}
            onChoose={(step) => startDebugResume(debugResumeState, step)}
            onQuit={leaveImport}
          />
        );
      if (importDefaults === undefined) return <></>;
      if (target === undefined) {
        return <PreflightScreen onChoose={setTarget} onQuit={leaveImport} />;
      }
      const inputStep = currentInputStep(target, answers);
      if (!scopeRun && !extractionRun && !tokensOnlyRun && inputStep !== 'credentials') {
        switch (inputStep) {
          case 'project':
            return (
              <WelcomeScreen
                onContinue={(projectPath) => answer({ projectPath })}
                onQuit={() => goBackFrom('project')}
                initialPath={importDefaults.componentDir}
              />
            );
          case 'token-file':
            return (
              <TokenInputScreen
                initialPath={importDefaults.tokenFile}
                onConfirm={(tokensPath) => answer({ tokensPath })}
                onBack={() => goBackFrom('token-file')}
              />
            );
          case 'path-validation':
            return (
              <PathValidationScreen
                projectPath={answers.projectPath ?? ''}
                hasTokens={target !== 'components'}
                onConfirm={({ filePaths, sourceInventory }) => {
                  answer({ scannedFiles: filePaths });
                  setSourceInventory(sourceInventory);
                }}
                onChangePath={() => resetImport(true)}
                onBack={() => goBackFrom('path-validation')}
              />
            );
        }
      }
      if (tokensOnlyRun) {
        if (tokensOnly?.status === 'done' && !tokensOnly.result.ok) {
          return (
            <ErrorStep stepName={tokensOnly.result.step} message={tokensOnly.result.message} onExit={leaveImport} />
          );
        }
        return (
          <RunningStep
            step="generation"
            description="Generating design tokens from your token file."
            lines={[{ text: `Generating token definitions via ${tokensOnlyRun.input.agent}...`, complete: false }]}
          />
        );
      }
      if (extractionRun) {
        if (extraction?.status === 'done' && !extraction.result.ok) {
          return (
            <ErrorStep stepName={extraction.result.step} message={extraction.result.message} onExit={leaveImport} />
          );
        }
        return (
          <ExtractionScreen
            progress={
              extraction?.status === 'running'
                ? extraction.progress
                : initialProgress({
                    hasCredentials: extractionRun.input.credentials !== null,
                    hasRawTokens: extractionRun.input.rawTokensPath !== '',
                  })
            }
            agent={extractionRun.input.agent}
          />
        );
      }
      if (scopeRun && scopeFlow) {
        if (scopeFlow.status === 'failed') {
          return <ErrorStep stepName="scope gate" message={scopeFlow.message} onExit={leaveImport} />;
        }
        if (scopeFlow.status === 'deciding') {
          return (
            <ScopeGateScreen
              components={scopeFlow.load.components}
              onConfirm={scopeFlow.confirm}
              onQuit={leaveImport}
            />
          );
        }
        if (generation?.status === 'done' && !generation.result.ok) {
          return (
            <ErrorStep stepName={generation.result.step} message={generation.result.message} onExit={leaveImport} />
          );
        }
        if (generation?.status === 'running') {
          return (
            <GenerationScreen
              progress={generation.progress}
              agent={scopeRun.input.agent}
              acceptedCount={scopeFlow.decisions.accepted.length}
              hasTokens={scopeRun.extraction.tokensPath !== ''}
            />
          );
        }
        return <></>;
      }
      return (
        <CredentialsScreen
          initial={importDefaults.credentials}
          tokensOnly={target === 'tokens'}
          onBack={() => goBackFrom('credentials')}
          onDone={(result) => void trackImportWork(finishCredentials(result, answers))}
        />
      );
    case 'help':
      return <HelpScreen onDone={goToStart} />;
    case 'settings':
      return <SettingsScreen onNavigate={setScreen} onBack={goToStart} />;
    case 'settings-configuration':
      return <ConfigurationScreen onDone={goToSettings} />;
    case 'settings-opt-in-analytics':
      return <OptInAnalyticsScreen onDone={goToSettings} />;
    case 'settings-debug-mode':
      return <DebugModeScreen onDone={goToSettings} />;
    case 'start':
      return <HomeScreen onNavigate={setScreen} />;
  }
}

export async function runApp(
  renderApp: (element: React.ReactElement) => { waitUntilExit: () => Promise<unknown>; clear?: () => void },
  importOptions: ImportOptions,
): Promise<void> {
  const inkClear = (): void => {
    // ink.clear() resets ink's own frame-height bookkeeping but doesn't erase stale terminal characters.
    // \x1b[H moves cursor home, \x1b[0J erases from cursor to end of screen — leaves scrollback intact.
    instance.clear?.();
    process.stdout.write('\x1b[H\x1b[0J');
  };
  const instance = renderApp(<App importOptions={importOptions} inkClear={inkClear} />);
  await instance.waitUntilExit();
}
