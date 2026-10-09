import type { Command } from 'commander';
import { normalizePath } from './path-utils.js';
import { parseAgentModel, resolveAgent, resolveModel } from './agent-model-resolve.js';
import { addAgentModelOptions } from '../lib/agent-model-options.js';
import { readExperiencesCredentials } from '../credentials-store.js';
import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '../host-utils.js';
import { buildCompositionForwardingOptions } from './composition-options.js';
import { getInteractiveTerminalSupport, requireInteractiveTerminal } from '../lib/terminal-capabilities.js';
import { checkAgentAuth, type AgentAuthStatus, type AgentName } from '@contentful/experience-design-system-generation';

export function registerImportCommand(program: Command): void {
  const cmd = program
    .command('import', { hidden: true })
    .description('Run the full pipeline: analyze → select → generate → push')
    .option('--project <path>', 'Path to the project root to analyze', '.');
  cmd.option(
    '--tokens <path>',
    'Path to a raw token source file (SCSS, CSS variables, JS/TS, Style Dictionary, etc.) to classify and import alongside components. Bypasses the interactive token prompt.',
  );
  addAgentModelOptions(cmd, {
    agentDescription:
      'Agent and optional model as agent:model or "agent model" (overrides credentials.json; falls back to "claude")',
    includeModel: false,
    includeBedrock: false,
  });
  cmd
    .option(
      '--prompt <stage=value>',
      'Override a composition, selection, token, generation, or token-mapping prompt (repeatable). value is a file path or literal text, e.g. --prompt select=./p.md',
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option('--no-cache', 'Re-run all steps even if output already exists')
    .action(async (opts: { project: string; agent?: string; tokens?: string; cache?: boolean; prompt?: string[] }) => {
      const interactiveTerminalSupported = getInteractiveTerminalSupport().supported;

      if (opts.tokens !== undefined) {
        const { access } = await import('node:fs/promises');
        try {
          await access(normalizePath(opts.tokens));
        } catch {
          process.stderr.write(`Error: --tokens: file not found: ${opts.tokens}\n`);
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
        const { renderWithGoodbye } = await import('../tui/render-with-goodbye.js');
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
          promptOverrides?: string[];
          noCache?: boolean;
          skipMapTokens?: boolean;
          livePreview?: boolean;
          generatePromptPath?: string;
          initialRawTokensPath?: string;
          initialAgentAuth?: Promise<AgentAuthStatus>;
        };
        const creds = await readExperiencesCredentials();
        const parsedAgentModel = parseAgentModel(opts.agent);
        const resolvedAgent = resolveAgent(parsedAgentModel.agent, creds.agent);
        const resolvedModel = resolveModel(parsedAgentModel.model, creds.agentModel);
        const initialAgentAuth = checkAgentAuth(resolvedAgent as AgentName);
        const { waitUntilExit } = renderWithGoodbye(
          createElement<WizardProps>(WizardApp, {
            initialSpaceId: creds.spaceId,
            initialEnvironmentId: creds.environmentId || 'master',
            initialCmaToken: creds.cmaToken,
            initialHost: toConfiguredHost(creds.host) ?? DEFAULT_CONFIGURED_HOST,
            initialAgent: resolvedAgent,
            ...(resolvedModel ? { initialModel: resolvedModel } : {}),
            initialProjectPath: opts.project !== '.' ? normalizePath(opts.project) : undefined,
            ...buildCompositionForwardingOptions(opts),
            noCache: opts.cache === false,
            skipMapTokens: false,
            livePreview: true,
            generatePromptPath: creds.generatePromptPath,
            ...(opts.tokens ? { initialRawTokensPath: normalizePath(opts.tokens) } : {}),
            initialAgentAuth,
          }),
        );
        await waitUntilExit();
        return;
      }
    });
}
