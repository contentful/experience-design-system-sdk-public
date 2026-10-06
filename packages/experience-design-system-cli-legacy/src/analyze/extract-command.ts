import type { Command } from 'commander';
import { addAgentModelOptions } from '../lib/agent-model-options.js';
import { runAnalyzeExtract } from './controller/run-analyze-extract.js';

export { resolveExtractNoCache } from './helpers/resolve-no-cache.js';
export { collectSourceFiles } from './services/collect-source-files.js';

export function registerInternalExtractCommand(program: Command): void {
  const extractCmd = program
    .command('__extract', { hidden: true })
    .description('Extract component definitions from a project')
    .requiredOption('--project <path>', 'Path to the project root')
    .option('--dir <path>', 'Path to the component source directory relative to the project root')
    .option(
      '--resolve-unreachable <mode>',
      "Retry pass for unresolved Svelte Props types: 'auto' (default), 'always', or 'never'",
      'auto',
    )
    .option('--composition-refresh', 'Force the mapping agent to run even where deterministic sources answered')
    .option('--no-cache', 'Re-run extraction even when all source files are unchanged')
    .option(
      '--prompt <stage=value>',
      'Override a stage prompt (repeatable). value is a file path or literal text, e.g. --prompt composition=./p.md',
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    );
  addAgentModelOptions(extractCmd, {
    includeModel: false,
    agentDescription: 'Coding agent for composition mapping resolution (claude|codex|opencode|cursor)',
  }).action(async (opts) => {
    await runAnalyzeExtract(opts);
  });
}
