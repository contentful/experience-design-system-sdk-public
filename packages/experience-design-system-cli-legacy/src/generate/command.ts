import type { Command } from 'commander';
import { addAgentModelOptions } from '../lib/agent-model-options.js';
import { runGenerateComponents } from './controller/run-generate-components.js';
import { runGenerateTokens } from './controller/run-generate-tokens.js';

export interface GenerateSubcommandOptions {
  agent?: string;
  model?: string;
  bedrock?: boolean;
  session?: string;
  rawTokens?: string;
  tokens?: string;
  tokenMap?: string;
  dryRun?: boolean;
  verbose?: boolean;
  cache?: boolean;
  generatePromptPath?: string;
  prompt?: string[];
  existingEntitiesPath?: string;
  cacheStatus?: boolean;
  restoreCache?: boolean;
  cachedComponents?: string;
}

function addAgentFlags(cmd: Command): Command {
  return addAgentModelOptions(cmd)
    .option('--verbose', 'Show full agent output including reasoning text')
    .option('--dry-run', 'Print the prompt without invoking the agent')
    .option(
      '--no-cache',
      'Bypass ALL fine-grained caches (extract, select, generate) and force AI re-run. ' +
        'Cache keys now factor in prompt content — changing the prompt file via --generate-prompt-path or ' +
        '--select-prompt-path will already bust the corresponding stage. Use --no-cache to force a full re-run.',
    );
}

export function registerInternalGenerateCommand(program: Command): void {
  const generate = program
    .command('__generate', { hidden: true })
    .description('Internal import pipeline generation command');

  const componentsCmd = generate
    .command('components')
    .description('Invoke a coding agent to produce components.json from raw analysis output')
    .option('--session <id>', 'Session ID from analyze extract (defaults to most recent)')
    .option('--tokens <path>', 'Path to tokens.json for token-linked prop resolution')
    .option('--token-map <path>', 'Path to token-name-map.json sidecar')
    .option(
      '--generate-prompt-path <path>',
      'Path to a custom .md skill prompt for components generation (bypasses bundled prompt invariants)',
    )
    .option(
      '--prompt <stage=value>',
      'Override a stage prompt (repeatable). Used here for the generate stage.',
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option(
      '--existing-entities-path <path>',
      'Path to the .existing-entities.json file written after CMA credentials are supplied. When present, per-component prompts include a summary of the target space so classifications can align to existing prop names/tokens. Missing/malformed files are treated as no-op.',
    );
  componentsCmd.option('--cache-status', 'Check whether all selected component definitions are cached');
  componentsCmd.option('--restore-cache', 'Restore cached component definitions into the current session');
  componentsCmd.option(
    '--cached-components <json>',
    'Component names already restored by a prior cache-status lookup; skip per-component cache lookup',
  );
  addAgentFlags(componentsCmd).action(async (opts: GenerateSubcommandOptions) => {
    await runGenerateComponents(opts, opts.verbose ?? false);
  });

  const tokensCmd = generate
    .command('tokens')
    .description('Invoke a coding agent to produce tokens.json from raw token data')
    .option('--raw-tokens <path>', 'Path to raw token input file')
    .option(
      '--prompt <stage=value>',
      'Override a stage prompt (repeatable). Used here for the tokens stage.',
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    );
  addAgentFlags(tokensCmd).action(async (opts: GenerateSubcommandOptions) => {
    await runGenerateTokens(opts, opts.verbose ?? false);
  });
}
