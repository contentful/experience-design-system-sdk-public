import type { Command } from 'commander';
import { normalizePath } from './path-utils.js';
import { readExperiencesCredentials } from '../credentials-store.js';
import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '../host-utils.js';
import { getInteractiveTerminalSupport, requireInteractiveTerminal } from '../lib/terminal-capabilities.js';

export function registerImportCommand(program: Command): void {
  program
    .command('import')
    .description('Run the full pipeline: analyze → select → generate → push')
    .option('--project <path>', 'Path to the project root to analyze', '.')
    .option('--tokens <path>', 'Path to a raw token source file to import alongside components')
    .option('--agent <name>', 'Agent to use for generation (overrides credentials.json; falls back to "claude")')
    .option(
      '--prompt <stage=value>',
      'Override a stage prompt (repeatable). value is a file path or literal text, e.g. --prompt composition=./p.md',
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
          compositionMap?: string;
          promptOverrides?: string[];
          noCache?: boolean;
          skipMapTokens?: boolean;
          livePreview?: boolean;
          generatePromptPath?: string;
          initialRawTokensPath?: string;
        };
        const creds = await readExperiencesCredentials();
        const resolvedAgent = opts.agent || creds.agent || 'claude';
        const resolvedModel = creds.agentModel || undefined;

        const { waitUntilExit } = render(
          createElement<WizardProps>(WizardApp, {
            initialSpaceId: creds.spaceId,
            initialEnvironmentId: creds.environmentId || 'master',
            initialCmaToken: creds.cmaToken,
            initialHost: toConfiguredHost(creds.host) ?? DEFAULT_CONFIGURED_HOST,
            initialAgent: resolvedAgent,
            ...(resolvedModel ? { initialModel: resolvedModel } : {}),
            initialProjectPath: opts.project !== '.' ? normalizePath(opts.project) : undefined,
            ...(opts.prompt && opts.prompt.length > 0 ? { promptOverrides: opts.prompt } : {}),
            noCache: opts.cache === false,
            livePreview: true,
            generatePromptPath: creds.generatePromptPath,
            ...(opts.tokens ? { initialRawTokensPath: normalizePath(opts.tokens) } : {}),
          }),
        );
        await waitUntilExit();
        return;
      }
    });
}
