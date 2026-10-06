import type { Command } from 'commander';
import { addAgentModelOptions } from '../lib/agent-model-options.js';
import { runMapTokens } from './controller/run-map-tokens.js';

export function registerMapTokensCommand(program: Command): void {
  const map = program
    .command('map', { hidden: true })
    .description('Suggest token restrictions for generated design-token props');

  const tokensCmd = map
    .command('tokens')
    .description('Invoke a coding agent to suggest $token.allowed for design-category token props')
    .option('--session <id>', 'Session ID from generate components (defaults to most recent)')
    .option('--print-prompt', 'Print the prompt without invoking the agent')
    .option('--skip-agent', 'Resolve token defaults without agentic $token.allowed inference')
    .option('--no-cache', 'Bypass the map-tokens cache and force a re-run')
    .option(
      '--prompt <stage=value>',
      'Override a stage prompt (repeatable). Used here for the map-tokens stage.',
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option('--token-map <path>', 'Path to token-name-map.json sidecar')
    .option(
      '--existing-entities-path <path>',
      'Path to the .existing-entities.json file written after CMA credentials are supplied. ' +
        "When present, the agent gets a list of the space's existing design tokens so it can prefer binding to them. " +
        'Missing/malformed files are treated as no-op.',
    );

  addAgentModelOptions(tokensCmd).action(async (opts) => {
    await runMapTokens(opts);
  });
}
