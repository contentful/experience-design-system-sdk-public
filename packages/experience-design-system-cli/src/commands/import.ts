import type { Command } from 'commander';
import { toImportOptions, type ImportOptions } from './import-options.js';
import { extractWatchFlag, runDevWatch } from './watch.js';

// Strip the leading `import` subcommand name so `--watch` can be forwarded to the restarted process.
function stripImportArg(argv: string[]): string[] {
  return argv[0] === 'import' ? argv.slice(1) : argv;
}

// The default command. It always opens the TUI; --watch restarts the TUI on every source change (repo checkout only).
export function registerImportCommand(program: Command, openTui: (options: ImportOptions) => Promise<void>): void {
  program
    .command('import', { isDefault: true })
    .description('Launch the Experiences CLI')
    .allowUnknownOption()
    .allowExcessArguments()
    .helpOption(false)
    .argument('[args...]')
    .option('--agent <name>', 'Agent (or agent:model) the import runs its steps with')
    .option(
      '--prompt <stage=value>',
      'Override a stage prompt (repeatable): a file path or literal text, e.g. --prompt select=./p.md',
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .action(async (_args: string[], raw: { agent?: string; prompt?: string[] }) => {
      const { watch, rest: forwarded } = extractWatchFlag(stripImportArg(process.argv.slice(2)));
      if (watch) {
        process.exit(await runDevWatch(forwarded));
      }
      await openTui(toImportOptions(raw));
    });
}
