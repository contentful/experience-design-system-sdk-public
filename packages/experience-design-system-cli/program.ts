import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { registerForwardedCommands } from './src/commands/forwarded.js';
import { registerImportCommand } from './src/commands/import.js';
import { findPackageRoot } from './src/tui/package-root.js';

const pkg = JSON.parse(
  readFileSync(
    join(findPackageRoot(import.meta.url, '@contentful/experience-design-system-cli'), 'package.json'),
    'utf8',
  ),
) as {
  version: string;
};

export function createProgram(): Command {
  const program = new Command()
    .name('experiences')
    .description('Contentful Experiences design system import CLI')
    .version(pkg.version, '--version', 'Print version number');

  registerImportCommand(program, async () => {
    const { render } = await import('ink');
    const { runApp } = await import('./app.js');
    await runApp(render);
  });
  registerForwardedCommands(program);

  return program;
}
