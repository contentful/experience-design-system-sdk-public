import type { Command } from 'commander';
import { resolve, join } from 'node:path';
import { agentSupportsBedrock, isAgentName } from '@contentful/experience-design-system-generation';
import { normalizePath } from './path-utils.js';
import { runPipeline } from './orchestrator.js';
import { resolveAutoFilter } from './auto-filter-resolve.js';
import { resolveAgent, resolveModel } from './agent-model-resolve.js';
import { addAgentModelOptions } from '../lib/agent-model-options.js';
import { resolveCompositionMode, type CompositionMode } from '../lib/composition-mode.js';
import { addAllowDeletionsOption, addCompositionOptions } from '../lib/command-options.js';
import { isConflictMode, type ConflictMode } from '../runs/save-path-resolver.js';
import { readExperiencesCredentials } from '../credentials-store.js';
import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '../host-utils.js';
import { replayRun, modifyRun } from '../runs/replay-helpers.js';
import { pickerPushRun } from '../runs/push-launcher.js';
import { resolvePromptFlags } from './print-prompt.js';
import { shouldShowRunPicker } from '../runs/run-picker-mount.js';
import type { RunPickerSelection } from '../runs/run-picker.js';
import { buildPickerCredentialOptions, buildPickerModifyOptions, dispatchPickerSelection } from './picker-dispatch.js';
import { buildCompositionForwardingOptions } from './composition-options.js';
import { getInteractiveTerminalSupport, requireInteractiveTerminal } from '../lib/terminal-capabilities.js';

async function runImportAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }
}

export function registerImportCommand(program: Command): void {
  const cmd = program
    .command('import')
    .description('Run the full pipeline: analyze → select → generate → push')
    .option('--space-id <id>', 'Contentful space ID (required unless --no-push)')
    .option('--environment-id <id>', 'Contentful environment ID (required unless --no-push)')
    .option('--cma-token <token>', 'CMA personal access token (or set CONTENTFUL_MANAGEMENT_TOKEN)')
    .option('--project <path>', 'Path to the project root to analyze', '.')
    .option('--out <path>', 'Output directory for pipeline artifacts');
  addAgentModelOptions(cmd, {
    agentDescription: 'Agent to use for generate components (overrides credentials.json; falls back to "claude")',
    modelDescription:
      'Model to use for generate components (defaults to a lightweight per-agent model; override with EDS_AGENT_MODEL_<AGENT>)',
  })
    .option(
      '--raw-tokens <path>',
      'Path to a raw token source file (SCSS, CSS variables, JS/TS, Style Dictionary, etc.) to classify and import alongside components. Bypasses the interactive token prompt.',
    )
    .option(
      '--skip-map-tokens',
      'Skip agentic token restrictions while still resolving deterministic token-default paths',
    )
    .option('--no-cache', 'Re-run all steps even if output already exists')
    .option('--verbose', 'Show full agent output and all entity progress')
    .option('--exclude-invalid', 'Automatically reject components with validation errors (empty names, collisions)')
    .option('--viewports <path>', 'JSON file with viewport array (passed to apply push)')
    .option('--host <url>', 'Override API base URL (passed to apply push)')
    .option(
      '--dry-run',
      "(deprecated, will change semantics in a future release) Print generate components prompt without invoking the agent. Use --print-prompt for the same behaviour explicitly, or '--dry-run --no-push' for the upcoming manifest-preview semantics.",
    )
    .option(
      '--print-prompt',
      'Print the generate components prompt without invoking the agent. Replaces the legacy --dry-run prompt-print behaviour on this command.',
    )
    ;
  addCompositionOptions(cmd);
  addAllowDeletionsOption(cmd);
  cmd
    .option('--composition-map <path>', 'Consume a hand-authored parent→children interchange map (implies --composite)')
    .option(
      '--composition-agent',
      'Opt into agentic mapping resolution when deterministic sources find no groups (implies --composite)',
    )
    .option(
      '--composition-refresh',
      'Bypass the composition cache and re-resolve from scratch, forcing the agent to run (implies --composite)',
    )
    .option(
      '--generate-map <path>',
      'Also write a composition-map skeleton from resolved edges during extract (implies --composite)',
    )
    .option(
      '--prompt <stage=value>',
      'Override a stage prompt (repeatable). value is a file path or literal text, e.g. --prompt composition=./p.md',
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option('--auto-reject-cycles', 'Automatically reject components involved in slot cycles and retry')
    .option('--auto-filter', 'Force the AI auto-filter ON (overrides the credentials.json autoFilter preference)')
    .option(
      '--no-push',
      'Import without pushing to Contentful. Interactive: runs the full wizard (extract → scope-gate → generate → final-review) and stops before push. Non-interactive (piped/CI): runs headless through generate. No credentials needed either way.',
    )
    .option('--no-save', 'Push without writing components.json / tokens.json to disk (default: save AND push)')
    .option(
      '--out-dir <path>',
      'Save components.json / tokens.json to this directory; bypasses the inline save-path prompt',
    )
    .option(
      '--on-conflict <mode>',
      "How to handle existing components.json / tokens.json at the save path: 'overwrite' replaces files, 'skip' writes to a timestamped subdirectory, 'fail' exits non-zero. Skips the wizard's interactive conflict gate when set.",
      (value: string): ConflictMode => {
        if (!isConflictMode(value)) {
          process.stderr.write(`Error: invalid --on-conflict value '${value}'. Use one of: overwrite, skip, fail.\n`);
          process.exit(1);
        }
        return value;
      },
    )
    .option(
      '--select-prompt-path <path>',
      'Path to a custom .md skill prompt for analyze select-agent (bypasses bundled invariants)',
    )
    .option(
      '--generate-prompt-path <path>',
      'Path to a custom .md skill prompt for generate components (bypasses bundled invariants)',
    )
    .option(
      '--push-from-run <id-or-path>',
      "Push a prior run's recorded pipeline.db session to Contentful WITHOUT writing components.json / tokens.json to disk. Accepts a run-id or filesystem path that matches a recorded savePath. Credentials are resolved from flags, then the run record, then 'experiences setup', then (in a TTY) an interactive prompt.",
    )
    .option(
      '--modify <id-or-path>',
      'Re-open the wizard at final-review with a prior run pre-populated for field edits. Accepts a run-id or filesystem path. Pair with --overwrite or --save-as-new to pick the save mode.',
    )
    .option('--overwrite', "Only valid with --modify: save back to the run's recorded savePath")
    .option('--save-as-new', 'Only valid with --modify: always save to a new path (prompts for one)')
    .option('--force', 'Bypass staleness checks when paired with --push-from-run or --modify.')
    .action(
      async (opts: {
        spaceId?: string;
        environmentId?: string;
        cmaToken?: string;
        project: string;
        out?: string;
        agent?: string;
        model?: string;
        bedrock?: boolean;
        rawTokens?: string;
        skipAnalyze?: boolean;
        skipGenerate?: boolean;
        skipMapTokens?: boolean;
        cache?: boolean;
        yes?: boolean;
        verbose?: boolean;
        excludeInvalid?: boolean;
        viewports?: string;
        host?: string;
        dryRun?: boolean;
        printPrompt?: boolean;
        composite?: boolean;
        atomic?: boolean;
        compositionMap?: string;
        compositionAgent?: boolean;
        compositionRefresh?: boolean;
        generateMap?: string;
        prompt?: string[];
        autoRejectCycles?: boolean;
        autoFilter?: boolean;
        livePreview?: boolean;
        push?: boolean;
        save?: boolean;
        outDir?: string;
        onConflict?: ConflictMode;
        selectPromptPath?: string;
        generatePromptPath?: string;
        pushFromRun?: string;
        modify?: string;
        overwrite?: boolean;
        saveAsNew?: boolean;
        force?: boolean;
        allowDeletions?: boolean;
      }) => {
        const interactiveTerminalSupported = getInteractiveTerminalSupport().supported;

        // --modify and --push-from-run resume a recorded session; the composition
        // mode comes from that run's record, so composition flags on the command
        // line don't apply. Warn and clear them rather than let them mislead.
        if (opts.modify !== undefined || opts.pushFromRun !== undefined) {
          const passedCompositionFlags = [
            opts.composite ? '--composite' : null,
            opts.atomic ? '--atomic' : null,
            opts.compositionMap ? '--composition-map' : null,
            opts.compositionAgent ? '--composition-agent' : null,
            opts.compositionRefresh ? '--composition-refresh' : null,
            opts.generateMap ? '--generate-map' : null,
          ].filter((f): f is string => f !== null);
          if (passedCompositionFlags.length > 0) {
            const entry = opts.modify !== undefined ? '--modify' : '--push-from-run';
            process.stderr.write(
              `Note: ${passedCompositionFlags.join(', ')} ignored with ${entry} — composition mode comes from the recorded run.\n`,
            );
            opts.composite = undefined;
            opts.atomic = undefined;
            opts.compositionMap = undefined;
            opts.compositionAgent = undefined;
            opts.compositionRefresh = undefined;
            opts.generateMap = undefined;
          }
        }

        if (opts.pushFromRun !== undefined) {
          if (opts.modify !== undefined) {
            process.stderr.write(
              'Error: --push-from-run and --modify are mutually exclusive. --push-from-run pushes the recorded session; --modify re-opens the wizard for edits.\n',
            );
            process.exit(1);
            return;
          }
          if (opts.project !== '.') {
            process.stderr.write(
              'Error: --push-from-run and --project are mutually exclusive. The project path is read from the recorded run.\n',
            );
            process.exit(1);
            return;
          }
          if (opts.save === false) {
            process.stderr.write(
              'Error: --push-from-run and --no-save are mutually exclusive. --push-from-run never writes to disk.\n',
            );
            process.exit(1);
            return;
          }
          if (opts.push === false) {
            process.stderr.write(
              'Error: --push-from-run and --no-push are mutually exclusive. Pushing is the whole point of --push-from-run.\n',
            );
            process.exit(1);
            return;
          }
          if (opts.overwrite || opts.saveAsNew) {
            process.stderr.write('Error: --overwrite and --save-as-new only apply with --modify.\n');
            process.exit(1);
            return;
          }
          const runIdOrPath = opts.pushFromRun;
          await runImportAction(() =>
            replayRun({
              runIdOrPath,
              ...(opts.spaceId ? { spaceId: opts.spaceId } : {}),
              ...(opts.environmentId ? { environmentId: opts.environmentId } : {}),
              ...(opts.cmaToken ? { cmaToken: opts.cmaToken } : {}),
              ...(opts.host ? { host: opts.host } : {}),
              interactive: interactiveTerminalSupported,
              ...(opts.force ? { force: true } : {}),
              ...(opts.allowDeletions ? { allowDeletions: true } : {}),
            }),
          );
          return;
        }

        if (opts.modify !== undefined) {
          if (opts.project !== '.') {
            process.stderr.write(
              'Error: --modify and --project are mutually exclusive. The project path is read from the recorded run.\n',
            );
            process.exit(1);
            return;
          }
          if (opts.overwrite && opts.saveAsNew) {
            process.stderr.write('Error: --overwrite and --save-as-new are mutually exclusive.\n');
            process.exit(1);
            return;
          }
          requireInteractiveTerminal({
            alternative: 'start a fresh headless import with the required credentials',
          });
          const runIdOrPath = opts.modify;
          await runImportAction(() =>
            modifyRun({
              runIdOrPath,
              ...(opts.overwrite ? { overwrite: true } : {}),
              ...(opts.saveAsNew ? { saveAsNew: true } : {}),
              ...(opts.outDir ? { outDir: opts.outDir } : {}),
              ...(opts.force ? { force: true } : {}),
              ...(opts.allowDeletions ? { allowDeletions: true } : {}),
            }),
          );
          return;
        }

        if (opts.overwrite || opts.saveAsNew) {
          process.stderr.write('Error: --overwrite and --save-as-new require --modify.\n');
          process.exit(1);
          return;
        }

        if (opts.save === false && opts.push === false) {
          process.stderr.write('Error: --no-save and --no-push together would do nothing. Pick one or neither.\n');
          process.exit(1);
          return;
        }
        if (opts.save === false && opts.outDir) {
          process.stderr.write(
            'Error: --no-save and --out-dir are mutually exclusive. --no-save disables disk writes; --out-dir picks a directory for them.\n',
          );
          process.exit(1);
          return;
        }
        if (opts.save === false && opts.onConflict) {
          process.stderr.write(
            'Error: --no-save and --on-conflict are mutually exclusive. --no-save disables disk writes; --on-conflict only applies when files are being written.\n',
          );
          process.exit(1);
          return;
        }

        if (opts.rawTokens !== undefined) {
          const { access } = await import('node:fs/promises');
          try {
            await access(normalizePath(opts.rawTokens));
          } catch {
            process.stderr.write(`Error: --raw-tokens: file not found: ${opts.rawTokens}\n`);
            process.exit(1);
            return;
          }
        }

        const promptFlags = resolvePromptFlags({
          ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
          ...(opts.printPrompt !== undefined ? { printPrompt: opts.printPrompt } : {}),
        });
        if (promptFlags.deprecationNotice) {
          process.stderr.write(promptFlags.deprecationNotice);
        }
        const dryRunForward = promptFlags.forwardDryRun;

        // "Don't push" is one user intent (--no-push); --skip-apply is a
        // deprecated alias. Interactive runs (TTY) take the wizard and stop
        // before push; non-interactive runs take the headless pipeline and stop
        // after generate. Either way no credentials are required.
        const noPushRequested = opts.push === false;

        const isHeadless =
          // A "don't push" request on a non-TTY is a headless intent (the wizard
          // needs a TTY); in a TTY it stays interactive and is NOT headless.
          (noPushRequested && !interactiveTerminalSupported) ||
          !!opts.spaceId ||
          !!opts.environmentId ||
          !!opts.cmaToken ||
          dryRunForward ||
          false;

        if (!interactiveTerminalSupported && !isHeadless) {
          requireInteractiveTerminal({
            alternative: 'use credentials or `--no-push`',
          });
        }

        if (interactiveTerminalSupported && !isHeadless) {
          const { render } = await import('ink');
          const { createElement } = await import('react');
          const { WizardApp } = await import('./tui/WizardApp.js');
          type WizardProps = {
            initialSpaceId?: string;
            initialEnvironmentId?: string;
            initialCmaToken?: string;
            initialHost?: string;
            initialAgent?: string;
            initialModel?: string;
            bedrock?: boolean;
            initialProjectPath?: string;
            host?: string;
            autoRejectCycles?: boolean;
            compositionMode?: CompositionMode;
            compositionMap?: string;
            compositionAgent?: boolean;
            compositionRefresh?: boolean;
            generateMap?: string;
            promptOverrides?: string[];
            noCache?: boolean;
            skipMapTokens?: boolean;
            autoFilter?: boolean;
            livePreview?: boolean;
            noPush?: boolean;
            noSave?: boolean;
            outDirOverride?: string;
            onConflictMode?: ConflictMode;
            selectPromptPath?: string;
            generatePromptPath?: string;
            initialRawTokensPath?: string;
            allowDeletions?: boolean;
            initialRuns?: typeof pickerDecision.runs;
            onRunPicked?: (selection: RunPickerSelection) => void;
          };
          const creds = await readExperiencesCredentials();
          const resolvedAgent = resolveAgent(opts.agent, creds.agent);
          const resolvedModel = resolveModel(opts.model, creds.agentModel);
          const resolvedCompositionMode = resolveCompositionMode(opts, creds.compositionMode);

          if (opts.bedrock && !(isAgentName(resolvedAgent) && agentSupportsBedrock(resolvedAgent))) {
            process.stderr.write(`Error: --bedrock is not supported for --agent ${resolvedAgent}\n`);
            process.exit(1);
          }

          const pickerDecision = await shouldShowRunPicker({
            flags: {
              ...(opts.pushFromRun !== undefined ? { pushFromRun: opts.pushFromRun } : {}),
              ...(opts.modify !== undefined ? { modify: opts.modify } : {}),
              ...(opts.project !== '.' ? { project: opts.project } : {}),
              ...(opts.dryRun ? { dryRun: true } : {}),
            },
            isTTY: !!process.stdin.isTTY,
          });

          let pickerSelection: RunPickerSelection | null = null;
          let unmountInk: (() => void) | null = null;
          const pickerProps: {
            initialRuns?: typeof pickerDecision.runs;
            onRunPicked?: (s: RunPickerSelection) => void;
          } = {};
          if (pickerDecision.shouldShow) {
            pickerProps.initialRuns = pickerDecision.runs;
            pickerProps.onRunPicked = (selection) => {
              pickerSelection = selection;
              unmountInk?.();
            };
          }

          const { waitUntilExit, unmount } = render(
            createElement<WizardProps>(WizardApp, {
              initialSpaceId: creds.spaceId,
              initialEnvironmentId: creds.environmentId || 'master',
              initialCmaToken: creds.cmaToken,
              initialHost: toConfiguredHost(opts.host ?? creds.host) ?? DEFAULT_CONFIGURED_HOST,
              initialAgent: resolvedAgent,
              ...(resolvedModel ? { initialModel: resolvedModel } : {}),
              ...(opts.bedrock ? { bedrock: true } : {}),
              initialProjectPath: opts.project !== '.' ? normalizePath(opts.project) : undefined,
              host: opts.host,
              autoRejectCycles: opts.autoRejectCycles ?? false,
              compositionMode: resolvedCompositionMode,
              ...buildCompositionForwardingOptions(opts),
              noCache: opts.cache === false,
              skipMapTokens: opts.skipMapTokens ?? false,
              autoFilter: resolveAutoFilter({ autoFilter: opts.autoFilter }, creds.autoFilter),
              livePreview: true,
              noPush: noPushRequested,
              noSave: opts.save === false,
              ...(opts.outDir ? { outDirOverride: resolve(opts.outDir) } : {}),
              ...(opts.onConflict ? { onConflictMode: opts.onConflict } : {}),
              selectPromptPath: opts.selectPromptPath ?? creds.selectPromptPath,
              generatePromptPath: opts.generatePromptPath ?? creds.generatePromptPath,
              ...(opts.rawTokens ? { initialRawTokensPath: normalizePath(opts.rawTokens) } : {}),
              allowDeletions: opts.allowDeletions === true,
              ...pickerProps,
            }),
          );
          unmountInk = unmount;
          await waitUntilExit();
          if (pickerSelection) {
            await dispatchPickerSelection(
              pickerSelection,
              {
                ...buildPickerCredentialOptions(opts),
                ...buildPickerModifyOptions(opts),
              },
              { replayRun, modifyRun, pickerPushRun },
            );
          }
          return;
        }

        // --no-push (and its deprecated alias --skip-apply) both mean "stop
        // before the push" on the headless path — so neither requires credentials.
        const skipApply = noPushRequested;
        const spaceId = opts.spaceId ?? process.env['CONTENTFUL_SPACE_ID'];
        const environmentId = opts.environmentId ?? process.env['CONTENTFUL_ENVIRONMENT_ID'];
        const cmaToken = opts.cmaToken ?? process.env['CONTENTFUL_MANAGEMENT_TOKEN'];

        if (!skipApply && (!spaceId || !environmentId || !cmaToken)) {
          process.stderr.write(
            'Error: --space-id (or CONTENTFUL_SPACE_ID), --environment-id (or CONTENTFUL_ENVIRONMENT_ID), and --cma-token (or CONTENTFUL_MANAGEMENT_TOKEN) are required unless --no-push is set.\n',
          );
          process.exit(1);
          return;
        }

        const projectRoot = normalizePath(opts.project);
        const outDir = opts.out ? resolve(opts.out) : join(projectRoot, '.contentful');

        const headlessCreds = await readExperiencesCredentials();
        const headlessAgent = resolveAgent(opts.agent, headlessCreds.agent);
        const headlessModel = resolveModel(opts.model, headlessCreds.agentModel);
        const headlessCompositionMode = resolveCompositionMode(opts, headlessCreds.compositionMode);

        if (opts.bedrock && !(isAgentName(headlessAgent) && agentSupportsBedrock(headlessAgent))) {
          process.stderr.write(`Error: --bedrock is not supported for --agent ${headlessAgent}\n`);
          process.exit(1);
        }

        const result = await runPipeline(
          {
            project: projectRoot,
            out: outDir,
            spaceId,
            environmentId,
            cmaToken,
            agent: headlessAgent,
            model: headlessModel,
            ...(opts.bedrock ? { bedrock: true } : {}),
            skipAnalyze: false,
            skipGenerate: false,
            skipMapTokens: opts.skipMapTokens ?? false,
            skipApply,
            noCache: opts.cache === false,
            yes: false,
            verbose: opts.verbose ?? false,
            excludeInvalid: opts.excludeInvalid ?? false,
            viewports: opts.viewports,
            host: opts.host,
            dryRun: dryRunForward,
            selectPromptPath: opts.selectPromptPath,
            autoRejectCycles: opts.autoRejectCycles ?? false,
            allowDeletions: opts.allowDeletions ?? false,
            compositionMode: headlessCompositionMode,
            ...buildCompositionForwardingOptions(opts),
          },
          (line) => process.stderr.write(line + '\n'),
        );

        const hasFailed = result.steps.some((s) => s.status === 'failed');
        if (!process.stdout.isTTY) {
          const json = JSON.stringify(result, null, 2) + '\n';
          await new Promise<void>((res) => process.stdout.write(json, () => res()));
        }
        process.exit(hasFailed ? 1 : 0);
      },
    );
}
