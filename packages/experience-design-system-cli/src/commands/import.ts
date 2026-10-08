import type { Command } from 'commander';
import { forwardedImportArgs } from '../legacy/forwarded-import-args.js';
import { runLegacy } from '../legacy/run-legacy.js';
import { extractWatchFlag, runDevWatch } from './watch.js';

// The default command. With no arguments it opens the TUI. With arguments it forwards them to the legacy import,
// except --watch, which restarts the TUI on every source change (repo checkout only).
export function registerImportCommand(program: Command, openTui: () => Promise<void>): void {
  program
    .command('import', { isDefault: true })
    .description('Launch the Experiences CLI')
    .allowUnknownOption()
    .allowExcessArguments()
    .helpOption(false)
    .argument('[args...]')
    .action(async () => {
      const { watch, rest: forwarded } = extractWatchFlag(forwardedImportArgs(process.argv.slice(2)));
      if (watch) {
        process.exit(await runDevWatch(forwarded));
      }
      if (forwarded.length > 0) {
        process.exit(await runLegacy(['import', ...forwarded]));
      }
      await openTui();
    });
}
