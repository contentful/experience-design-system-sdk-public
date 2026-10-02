import { readFileSync } from 'node:fs';
import { Command } from 'commander';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export function createProgram(): Command {
  const program = new Command()
    .name('experiences-v2')
    .description('Contentful Experiences import TUI (v2)')
    .version(pkg.version, '--version', 'Print version number');

  program
    .command('importv2', { isDefault: true })
    .description('Launch the v2 import TUI')
    .action(async () => {
      const { render } = await import('ink');
      const { runApp } = await import('./app.js');
      await runApp(render);
    });

  return program;
}
