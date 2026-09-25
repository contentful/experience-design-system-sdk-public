import type { Command } from 'commander';
import { agentSupportsBedrock, isAgentName } from '@contentful/experience-design-system-generation';
import { normalizePath } from './path-utils.js';
import { resolveAgent, resolveModel } from './agent-model-resolve.js';
import { addAgentModelOptions } from '../lib/agent-model-options.js';
import { resolveCompositionMode, type CompositionMode } from '../lib/composition-mode.js';
import { addCompositionOptions } from '../lib/command-options.js';
import { readExperiencesCredentials } from '../credentials-store.js';
import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '../host-utils.js';
import { buildCompositionForwardingOptions } from './composition-options.js';
import { getInteractiveTerminalSupport, requireInteractiveTerminal } from '../lib/terminal-capabilities.js';

export function registerImportCommand(program: Command): void {
  const cmd = program
    .command('import')
    .description('Run the full pipeline: analyze → select → generate → push')
    .option('--project <path>', 'Path to the project root to analyze', '.');
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
    .option('--no-cache', 'Re-run all steps even if output already exists');
  addCompositionOptions(cmd);
  cmd
    .option('--composition-map <path>', 'Consume a hand-authored parent→children interchange map (implies --composite)')
    .option(
      '--prompt <stage=value>',
      'Override a stage prompt (repeatable). value is a file path or literal text, e.g. --prompt composition=./p.md',
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .action(
      async (opts: {
        project: string;
        agent?: string;
        model?: string;
        bedrock?: boolean;
        rawTokens?: string;
        skipMapTokens?: boolean;
        cache?: boolean;
        composite?: boolean;
        compositionMap?: string;
        prompt?: string[];
      }) => {
        const interactiveTerminalSupported = getInteractiveTerminalSupport().supported;

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

        if (!interactiveTerminalSupported) {
          requireInteractiveTerminal({
            alternative: 'run experiences import in an interactive terminal',
          });
        }

        {
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
            compositionMode?: CompositionMode;
            compositionMap?: string;
            promptOverrides?: string[];
            noCache?: boolean;
            skipMapTokens?: boolean;
            livePreview?: boolean;
            generatePromptPath?: string;
            initialRawTokensPath?: string;
          };
          const creds = await readExperiencesCredentials();
          const resolvedAgent = resolveAgent(opts.agent, creds.agent);
          const resolvedModel = resolveModel(opts.model, creds.agentModel);
          const resolvedCompositionMode = resolveCompositionMode(opts, creds.compositionMode);

          if (opts.bedrock && !(isAgentName(resolvedAgent) && agentSupportsBedrock(resolvedAgent))) {
            process.stderr.write(`Error: --bedrock is not supported for --agent ${resolvedAgent}\n`);
            process.exit(1);
          }

          const { waitUntilExit } = render(
            createElement<WizardProps>(WizardApp, {
              initialSpaceId: creds.spaceId,
              initialEnvironmentId: creds.environmentId || 'master',
              initialCmaToken: creds.cmaToken,
              initialHost: toConfiguredHost(creds.host) ?? DEFAULT_CONFIGURED_HOST,
              initialAgent: resolvedAgent,
              ...(resolvedModel ? { initialModel: resolvedModel } : {}),
              ...(opts.bedrock ? { bedrock: true } : {}),
              initialProjectPath: opts.project !== '.' ? normalizePath(opts.project) : undefined,
              compositionMode: resolvedCompositionMode,
              ...buildCompositionForwardingOptions(opts),
              noCache: opts.cache === false,
              skipMapTokens: opts.skipMapTokens ?? false,
              livePreview: true,
              generatePromptPath: creds.generatePromptPath,
              ...(opts.rawTokens ? { initialRawTokensPath: normalizePath(opts.rawTokens) } : {}),
            }),
          );
          await waitUntilExit();
          return;
        }
      },
    );
}
