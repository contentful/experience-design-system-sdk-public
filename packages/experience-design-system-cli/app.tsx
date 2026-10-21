import React, { useEffect, useState } from 'react';
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
  TOKENS_ONLY_OVERVIEW,
  TOKENS_ONLY_STEP_COUNT,
  type ImportStepId,
  type ImportTarget,
  type InputAnswers,
} from './src/tui/import/steps/00-preflight/logic.js';
import { ErrorStep, RunningStep } from './src/tui/import/shared/index.js';
import { resolveAgentChoice, stepNumbers } from './src/tui/import/steps/06-extraction/logic.js';
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
}

interface ExtractionRun {
  launch: ImportLaunch;
  credentialsSkipped: boolean;
  input: ExtractionInput;
  /** A custom prompt for `generate components`, saved in the config. Read now, used when generation starts. */
  generatePromptPath?: string;
}

// Set when the import only generates tokens. There is no extraction, scope gate or generation: once the tokens exist the
// flow starts at saving.
interface TokensOnlyRun {
  credentialsSkipped: boolean;
  /** What the flow builds its start from (agent, credentials, project). It names no files: nothing is scanned. */
  input: ExtractionInput;
  tokens: TokensOnlyInput;
}

// Set once extraction has produced a session; the scope gate runs for it before the review starts.
interface ScopeRun {
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
  const [screen, setScreen] = useState<Screen>('start');
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
      sessionId: scopeRun.extraction.sessionId,
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

  // Read the saved defaults each time the import flow opens, so a change in Settings shows up right away.
  // The screens only read their initial value on mount, so they wait for this to resolve.
  useEffect(() => {
    if (screen !== 'import') {
      setImportDefaults(undefined);
      return;
    }
    void readCredentials().then((saved) =>
      setImportDefaults({
        componentDir: saved.defaultComponentDir ?? '',
        tokenFile: saved.defaultTokenFile ?? '',
        credentials: saved,
      }),
    );
  }, [screen]);

  const finishCredentials = async (result: CredentialsResult, collected: InputAnswers): Promise<void> => {
    if (!result.skipped) await writeCredentials({ ...result.credentials });
    const launch: ImportLaunch = {
      // a tokens-only import has no project, so its files go where runBaseDir says
      projectPath: runBaseDir({ ...collected, configuredBaseDir: importDefaults?.credentials.contentfulBaseDir }),
      tokens: collected.tokensPath ?? '',
      filePaths: collected.scannedFiles ?? [],
      ...importOptions,
    };
    // Every run generates new files; reusing an earlier tokens.json is not offered.
    if (target === 'tokens') await startTokensOnly(launch, result);
    else await startExtraction(launch, result);
  };

  // What both kinds of run start from: the agent, this run's folder and the input every stage reads.
  const prepareRun = async (
    launch: ImportLaunch,
    credentials: CredentialsResult,
  ): Promise<{ input: ExtractionInput; outDir: string; launch: ImportLaunch; generatePromptPath?: string }> => {
    const settings = await readSettings();
    const { agent, agentModel } = resolveAgentChoice(launch.agent, settings);
    const generatePromptPath =
      typeof settings.generatePromptPath === 'string' ? settings.generatePromptPath : undefined;
    // Loaded on first use because the debug store reads the settings as soon as it is imported.
    const outDir = await (
      await import('./src/tui/debug-store.js')
    ).startImportRun(resolveUserPath(launch.projectPath ?? ''));
    return {
      ...(generatePromptPath ? { generatePromptPath } : {}),
      outDir,
      // the later steps get the same agent, so they use what the stage used
      launch: { ...launch, agent: agentModel ? `${agent}:${agentModel}` : agent },
      input: {
        projectPath: resolveUserPath(launch.projectPath ?? ''),
        outDir,
        filePaths: launch.filePaths ?? [],
        rawTokensPath: launch.tokens ?? '',
        credentials: credentials.skipped ? null : credentials.credentials,
        agent,
        ...(agentModel ? { agentModel } : {}),
        promptOverrides: launch.prompt ?? [],
        noCache: launch.cache === false,
      },
    };
  };

  const startExtraction = async (launch: ImportLaunch, credentials: CredentialsResult): Promise<void> => {
    const run = await prepareRun(launch, credentials);
    setExtractionRun({
      ...(run.generatePromptPath ? { generatePromptPath: run.generatePromptPath } : {}),
      launch: run.launch,
      credentialsSkipped: credentials.skipped,
      input: run.input,
    });
  };

  const startTokensOnly = async (launch: ImportLaunch, credentials: CredentialsResult): Promise<void> => {
    const { input, outDir } = await prepareRun(launch, credentials);
    setTokensOnlyRun({
      credentialsSkipped: credentials.skipped,
      input,
      tokens: {
        rawTokensPath: input.rawTokensPath,
        outDir,
        agent: input.agent,
        ...(input.agentModel ? { agentModel: input.agentModel } : {}),
        promptOverrides: input.promptOverrides,
        noCache: input.noCache,
      },
    });
  };

  // Finished tokens start the flow at saving, once. There is no review: no components were generated.
  useEffect(() => {
    if (!tokensOnlyRun || tokensOnly?.status !== 'done' || !tokensOnly.result.ok) return;
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
    if (!extractionRun || extraction?.status !== 'done' || !extraction.result.ok) return;
    setExtractionRun(undefined);
    setScopeRun({ ...extractionRun, extraction: extraction.result.extraction });
  }, [extraction, extractionRun]);

  // A confirmed scope starts generation, once. The cache check that ran at the gate is handed over so generation can
  // wait for it before it saves the decisions.
  useEffect(() => {
    if (!scopeRun || scopeFlow?.status !== 'confirmed' || generationInput) return;
    const { extraction: produced, input, generatePromptPath } = scopeRun;
    setGenerationInput({
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
    });
  }, [scopeFlow, scopeRun, generationInput]);

  // Finished generation starts the review and everything after it, exactly once, with everything the stages did.
  useEffect(() => {
    if (!scopeRun || generation?.status !== 'done' || !generation.result.ok) return;
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
    if (!keepTarget) setTarget(undefined);
    setAnswers({});
    setExtractionRun(undefined);
    setTokensOnlyRun(undefined);
    setScopeRun(undefined);
    setGenerationInput(undefined);
    setFlowStart(undefined);
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
    const back = goBack(target, current, answers);
    if (back.to === 'preflight') setTarget(undefined);
    else setAnswers(back.answers);
  };

  switch (screen) {
    case 'import':
      if (showImportResult) return <ImportScreen exitCode={importExitCode} onDone={finishImportResult} />;
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
      if (importDefaults === undefined) return <></>;
      if (target === undefined) {
        return <PreflightScreen onChoose={setTarget} onQuit={leaveImport} />;
      }
      const inputStep = currentInputStep(target, answers);
      if (!extractionRun && !tokensOnlyRun && inputStep !== 'credentials') {
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
                {...(target === 'tokens' ? { overview: TOKENS_ONLY_OVERVIEW } : {})}
                initialPath={importDefaults.tokenFile}
                onConfirm={(tokensPath) => answer({ tokensPath })}
                onBack={() => goBackFrom('token-file')}
              />
            );
          case 'path-validation':
            return (
              <PathValidationScreen
                projectPath={answers.projectPath ?? ''}
                onConfirm={({ filePaths }) => answer({ scannedFiles: filePaths })}
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
            stepNumber={1}
            totalSteps={TOKENS_ONLY_STEP_COUNT}
            title="Generating design tokens"
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
        if (extraction?.status === 'running') {
          return (
            <ExtractionScreen
              progress={extraction.progress}
              agent={extractionRun.input.agent}
              {...stepNumbers({ hasRawTokens: extractionRun.input.rawTokensPath !== '' })}
            />
          );
        }
        return <></>;
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
          // the generating step comes right after extraction; the count grows by one once token mapping is known to run
          const hasRawTokens = scopeRun.input.rawTokensPath !== '';
          const counted = stepNumbers({
            hasRawTokens,
            mapTokensEligible: generation.progress.mapTokensEligible,
          });
          return (
            <GenerationScreen
              progress={generation.progress}
              agent={scopeRun.input.agent}
              acceptedCount={scopeFlow.decisions.accepted.length}
              hasTokens={scopeRun.extraction.tokensPath !== ''}
              stepNumber={hasRawTokens ? 4 : 3}
              totalSteps={counted.totalSteps}
            />
          );
        }
        return <></>;
      }
      return (
        <CredentialsScreen
          initial={importDefaults.credentials}
          onBack={() => goBackFrom('credentials')}
          onDone={(result) => void finishCredentials(result, answers)}
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
