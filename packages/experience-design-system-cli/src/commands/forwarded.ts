import type { Command } from 'commander';
import { runLegacy } from '../legacy/run-legacy.js';

// Commands the new CLI does not implement yet. They are passed to the bundled legacy CLI unchanged.
const FORWARDED_COMMANDS = [
  {
    name: 'apply',
    description: 'Apply a CDF file of components and design tokens to Contentful',
  },
  {
    name: 'setup',
    description: 'Configure prerequisites, credentials and the coding agent',
  },
  { name: 'doctor', description: 'Check prerequisites and configuration' },
  { name: 'print', hidden: true },
  { name: 'map', hidden: true },
  { name: '__extract', hidden: true },
  { name: '__generate', hidden: true },
] as const;

export function registerForwardedCommands(program: Command): void {
  for (const entry of FORWARDED_COMMANDS) {
    const hidden = 'hidden' in entry;
    const command = program.command(entry.name, { hidden });
    if (!hidden) command.description(entry.description);
    command
      .allowUnknownOption()
      .allowExcessArguments()
      .helpOption(false)
      .argument('[args...]')
      .action(async () => {
        process.exit(await runLegacy(process.argv.slice(2)));
      });
  }
}
