import type { Command } from 'commander';
import { resolve, join } from 'node:path';
import { runPipeline } from './orchestrator.js';
import { resolveAutoFilter } from './auto-filter-resolve.js';
import { resolveAgent, resolveModel } from './agent-model-resolve.js';
import { readExperiencesCredentials } from '../credentials-store.js';
import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '../host-utils.js';
import { replayRun, modifyRun } from '../runs/replay-helpers.js';
import { resolvePromptFlags } from './print-prompt.js';
import { shouldShowRunPicker } from '../runs/run-picker-mount.js';
import type { RunPickerSelection } from '../runs/run-picker.js';

export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Run the full pipeline: analyze → select → generate → push')
    .option('--space-id <id>', 'Contentful space ID (required unless --skip-apply)')
    .option('--environment-id <id>', 'Contentful environment ID (required unless --skip-apply)')
    .option('--cma-token <token>', 'CMA personal access token (or set CONTENTFUL_MANAGEMENT_TOKEN)')
    .option('--project <path>', 'Path to the project root to analyze', '.')
    .option('--out <path>', 'Output directory for pipeline artifacts')
    .option(
      '--agent <name>',
      'Agent to use for generate components (overrides credentials.json; falls back to "claude")',
    )
    .option('--model <name>', 'Model to use for generate components (defaults to a small/fast model per agent)')
    .option('--tokens <path>', 'Path to a DTCG tokens.json file to push alongside generated components')
    .option(
      '--raw-tokens <path>',
      'Path to a raw token source file (SCSS, CSS variables, JS/TS, Style Dictionary, etc.) to classify and import alongside components. Bypasses the interactive token prompt.',
    )
    .option('--select-all', 'Select all extracted components for generation (default)')
    .option(
      '--select <pattern>',
      'Select components matching pattern (repeatable)',
      (v, a: string[]) => [...a, v],
      [] as string[],
    )
    .option(
      '--deselect <pattern>',
      'Deselect components matching pattern (repeatable)',
      (v, a: string[]) => [...a, v],
      [] as string[],
    )
    .option('--skip-analyze', 'Skip the analyze step (uses most recent extract session)')
    .option('--skip-generate', 'Skip the generate step (uses most recent generate session)')
    .option('--print', 'Write components.json to --out after generation')
    .option('--skip-apply', 'Skip pushing to Contentful (stops after generate)')
    .option('--no-cache', 'Re-run all steps even if output already exists')
    .option('--yes', 'Skip interactive confirmation in apply push')
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
    .option('--auto-accept-scope', 'Accept all extracted components without prompting (for scripted/non-TTY callers)')
    .option('--auto-filter', 'Force the AI auto-filter ON (overrides the credentials.json autoFilter preference)')
    .option(
      '--no-auto-filter',
      'Skip the automatic AI pre-filter; jump straight to manual scope-gate (overrides the credentials.json autoFilter preference; no-op when paired with --auto-accept-scope)',
    )
    .option(
      '--no-live-preview',
      'Skip the automatic preview re-run after each FieldEditor save (no-op when paired with --auto-accept-scope)',
    )
    .option(
      '--no-push',
      'Run extract → scope-gate → generate → final-review and exit without pushing to Contentful (no credentials prompt; live preview disabled)',
    )
    .option('--no-save', 'Push without writing components.json / tokens.json to disk (default: save AND push)')
    .option(
      '--out-dir <path>',
      'Save components.json / tokens.json to this directory; bypasses the inline save-path prompt',
    )
    .option(
      '--on-conflict <mode>',
      "How to handle existing components.json / tokens.json at the save path: 'overwrite' replaces files, 'skip' writes to a timestamped subdirectory, 'fail' exits non-zero. Skips the wizard's interactive conflict gate when set.",
      (value: string): string => {
        if (value !== 'overwrite' && value !== 'skip' && value !== 'fail') {
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
        tokens?: string;
        rawTokens?: string;
        selectAll?: boolean;
        select: string[];
        deselect: string[];
        skipAnalyze?: boolean;
        skipGenerate?: boolean;
        print?: boolean;
        skipApply?: boolean;
        cache?: boolean;
        yes?: boolean;
        verbose?: boolean;
        excludeInvalid?: boolean;
        viewports?: string;
        host?: string;
        dryRun?: boolean;
        printPrompt?: boolean;
        autoAcceptScope?: boolean;
        autoFilter?: boolean;
        livePreview?: boolean;
        push?: boolean;
        save?: boolean;
        outDir?: string;
        onConflict?: 'overwrite' | 'skip' | 'fail';
        selectPromptPath?: string;
        generatePromptPath?: string;
        pushFromRun?: string;
        modify?: string;
        overwrite?: boolean;
        saveAsNew?: boolean;
        force?: boolean;
      }) => {
        // ── --push-from-run handling ───────────────────────────────────────
        // Push-only replay of a prior run. Mutex checks happen *before* any
        // side effects (no DB reads, no wizard render).
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
          try {
            await replayRun({
              runIdOrPath: opts.pushFromRun,
              ...(opts.spaceId ? { spaceId: opts.spaceId } : {}),
              ...(opts.environmentId ? { environmentId: opts.environmentId } : {}),
              ...(opts.cmaToken ? { cmaToken: opts.cmaToken } : {}),
              ...(opts.host ? { host: opts.host } : {}),
              interactive: !!process.stdout.isTTY,
              ...(opts.force ? { force: true } : {}),
            });
            return;
          } catch (err) {
            process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
            process.exit(1);
            return;
          }
        }

        // ── --modify handling ──────────────────────────────────────────────
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
          try {
            await modifyRun({
              runIdOrPath: opts.modify,
              ...(opts.overwrite ? { overwrite: true } : {}),
              ...(opts.saveAsNew ? { saveAsNew: true } : {}),
              ...(opts.outDir ? { outDir: opts.outDir } : {}),
              ...(opts.force ? { force: true } : {}),
            });
            return;
          } catch (err) {
            process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
            process.exit(1);
            return;
          }
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

        // ── --raw-tokens validation ─────────────────────────────────────────
        // The raw-tokens path is a source file the wizard hands to
        // `generate tokens --raw-tokens <path>`. Validate at parse time so
        // operators get an immediate error before the wizard renders.
        if (opts.rawTokens !== undefined) {
          if (opts.tokens !== undefined) {
            process.stderr.write(
              'Error: --raw-tokens and --tokens are mutually exclusive: --raw-tokens is the source file to classify, --tokens is a pre-classified DTCG sidecar.\n',
            );
            process.exit(1);
            return;
          }
          const { access } = await import('node:fs/promises');
          try {
            await access(opts.rawTokens);
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

        const isHeadless =
          opts.skipAnalyze ||
          opts.skipGenerate ||
          opts.skipApply ||
          !!opts.spaceId ||
          !!opts.environmentId ||
          !!opts.cmaToken ||
          opts.yes ||
          dryRunForward ||
          false;

        const autoAcceptScope = opts.autoAcceptScope ?? false;

        if (!process.stdout.isTTY && !isHeadless && !autoAcceptScope) {
          process.stderr.write(
            'Error: experiences import is interactive. Pass --auto-accept-scope, or use a headless mode by providing credentials (--space-id, --environment-id, --cma-token) or one of --skip-analyze, --skip-generate, --skip-apply, --yes, --dry-run, --print-prompt.\n',
          );
          process.exit(1);
          return;
        }

        if (process.stdout.isTTY && !isHeadless) {
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
            initialProjectPath?: string;
            host?: string;
            autoAcceptScope?: boolean;
            noCache?: boolean;
            autoFilter?: boolean;
            livePreview?: boolean;
            noPush?: boolean;
            noSave?: boolean;
            outDirOverride?: string;
            onConflictMode?: 'overwrite' | 'skip' | 'fail';
            selectPromptPath?: string;
            generatePromptPath?: string;
            initialRawTokensPath?: string;
            initialRuns?: typeof pickerDecision.runs;
            onRunPicked?: (selection: RunPickerSelection) => void;
          };
          const creds = await readExperiencesCredentials();
          // Parity-audit Q4: resolve --agent / --model overrides against the
          // stored credentials.json so both flags are functional for the
          // wizard path. Flag wins, then stored value, then default.
          const resolvedAgent = resolveAgent(opts.agent, creds.agent);
          const resolvedModel = resolveModel(opts.model, creds.agentModel);

          // ── Run picker decision ─────────────────────────────────────────
          // When runs.json has prior entries and the operator didn't ask for
          // a specific entry point, open the wizard with the run picker. The
          // helper enforces every gate (TTY, conflicting flags, file state).
          const pickerDecision = await shouldShowRunPicker({
            flags: {
              ...(opts.pushFromRun !== undefined ? { pushFromRun: opts.pushFromRun } : {}),
              ...(opts.modify !== undefined ? { modify: opts.modify } : {}),
              ...(opts.project !== '.' ? { project: opts.project } : {}),
              ...(opts.autoAcceptScope ? { autoAcceptScope: true } : {}),
              ...(opts.dryRun ? { dryRun: true } : {}),
            },
            isTTY: !!process.stdin.isTTY,
          });

          let pickerSelection: RunPickerSelection | null = null;
          const pickerProps: {
            initialRuns?: typeof pickerDecision.runs;
            onRunPicked?: (s: RunPickerSelection) => void;
          } = {};
          if (pickerDecision.shouldShow) {
            pickerProps.initialRuns = pickerDecision.runs;
            pickerProps.onRunPicked = (selection) => {
              pickerSelection = selection;
              setImmediate(() => process.exit(0));
            };
          }

          const { waitUntilExit } = render(
            createElement<WizardProps>(WizardApp, {
              initialSpaceId: creds.spaceId,
              initialEnvironmentId: creds.environmentId || 'master',
              initialCmaToken: creds.cmaToken,
              initialHost: toConfiguredHost(opts.host ?? creds.host) ?? DEFAULT_CONFIGURED_HOST,
              initialAgent: resolvedAgent,
              ...(resolvedModel ? { initialModel: resolvedModel } : {}),
              initialProjectPath: opts.project !== '.' ? resolve(opts.project) : undefined,
              host: opts.host,
              autoAcceptScope,
              noCache: opts.cache === false,
              autoFilter: resolveAutoFilter({ autoFilter: opts.autoFilter }, creds.autoFilter),
              livePreview: opts.livePreview !== false,
              noPush: opts.push === false,
              noSave: opts.save === false,
              ...(opts.outDir ? { outDirOverride: resolve(opts.outDir) } : {}),
              ...(opts.onConflict ? { onConflictMode: opts.onConflict } : {}),
              selectPromptPath: opts.selectPromptPath ?? creds.selectPromptPath,
              generatePromptPath: opts.generatePromptPath ?? creds.generatePromptPath,
              ...(opts.rawTokens ? { initialRawTokensPath: resolve(opts.rawTokens) } : {}),
              ...pickerProps,
            }),
          );
          try {
            await waitUntilExit();
          } catch {
            /* Ink throws on process.exit; swallow so picker dispatch can run. */
          }
          // ── Picker dispatch ─────────────────────────────────────────────
          // If the operator picked a run, route into the existing entry
          // points so credential resolution and mutex checks stay in one
          // place. The --modify path resolves the run record via
          // resolveRunTarget and threads its session IDs through
          // launchModifyWizard (see runs/replay-helpers.ts).
          if (pickerSelection) {
            const sel = pickerSelection as RunPickerSelection;
            if (sel.action === 'push' && sel.runId) {
              await replayRun({
                runIdOrPath: sel.runId,
                ...(opts.spaceId ? { spaceId: opts.spaceId } : {}),
                ...(opts.environmentId ? { environmentId: opts.environmentId } : {}),
                ...(opts.cmaToken ? { cmaToken: opts.cmaToken } : {}),
                ...(opts.host ? { host: opts.host } : {}),
                interactive: !!process.stdout.isTTY,
                ...(opts.force ? { force: true } : {}),
              });
              return;
            }
            if (sel.action === 'modify' && sel.runId) {
              await modifyRun({
                runIdOrPath: sel.runId,
                ...(opts.outDir ? { outDir: opts.outDir } : {}),
                ...(opts.overwrite ? { overwrite: true } : {}),
                ...(opts.saveAsNew ? { saveAsNew: true } : {}),
                ...(opts.force ? { force: true } : {}),
              });
              return;
            }
            // action === 'new' falls through — the wizard already advanced.
          }
          return;
        }

        const skipApply = opts.skipApply ?? false;
        const spaceId = opts.spaceId ?? process.env['CONTENTFUL_SPACE_ID'];
        const environmentId = opts.environmentId ?? process.env['CONTENTFUL_ENVIRONMENT_ID'];
        const cmaToken = opts.cmaToken ?? process.env['CONTENTFUL_MANAGEMENT_TOKEN'];

        if (!skipApply && (!spaceId || !environmentId || !cmaToken)) {
          process.stderr.write(
            'Error: --space-id (or CONTENTFUL_SPACE_ID), --environment-id (or CONTENTFUL_ENVIRONMENT_ID), and --cma-token (or CONTENTFUL_MANAGEMENT_TOKEN) are required unless --skip-apply is set.\n',
          );
          process.exit(1);
          return;
        }

        const projectRoot = resolve(opts.project);
        const outDir = opts.out ? resolve(opts.out) : join(projectRoot, '.contentful');

        // Parity-audit Q4: also honor stored agent/model in headless mode.
        const headlessCreds = await readExperiencesCredentials();
        const headlessAgent = resolveAgent(opts.agent, headlessCreds.agent);
        const headlessModel = resolveModel(opts.model, headlessCreds.agentModel);

        const result = await runPipeline(
          {
            project: projectRoot,
            out: outDir,
            spaceId,
            environmentId,
            cmaToken,
            agent: headlessAgent,
            model: headlessModel,
            tokens: opts.tokens,
            selectAll: opts.selectAll,
            select: opts.select.length > 0 ? opts.select : undefined,
            deselect: opts.deselect.length > 0 ? opts.deselect : undefined,
            skipAnalyze: opts.skipAnalyze ?? false,
            skipGenerate: opts.skipGenerate ?? false,
            print: opts.print ?? false,
            skipApply,
            noCache: opts.cache === false,
            yes: opts.yes ?? false,
            verbose: opts.verbose ?? false,
            excludeInvalid: opts.excludeInvalid ?? false,
            viewports: opts.viewports,
            host: opts.host,
            dryRun: dryRunForward,
            selectPromptPath: opts.selectPromptPath,
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
