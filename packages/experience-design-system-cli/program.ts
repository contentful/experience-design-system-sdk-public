import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { runLegacy } from './src/legacy/run-legacy.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

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

function registerForwardedCommands(program: Command): void {
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

export function createProgram(): Command {
  const program = new Command()
    .name('experiences')
    .description('Contentful Experiences design system import CLI')
    .version(pkg.version, '--version', 'Print version number');

  program
    .command('import', { isDefault: true })
    .alias('importv2')
    .description('Launch the Experiences CLI')
    .action(async () => {
      const { render } = await import('ink');
      const { runApp } = await import('./app.js');
      await runApp(render);
    });

  registerForwardedCommands(program);

  return program;
}
