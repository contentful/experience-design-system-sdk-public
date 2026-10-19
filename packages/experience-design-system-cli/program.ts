import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import {
  completeActiveCommand,
  failActiveCommand,
  flushAnalytics,
  noteCommandStart,
  setCliVersion,
  setPersistedAnalyticsDisabled,
} from '@contentful/experience-design-system-backend-pipeline';
import { registerForwardedCommands } from './src/commands/forwarded.js';
import { registerImportCommand } from './src/commands/import.js';
import { readAnalyticsSetting } from './src/tui/settings/opt-in-analytics/analytics-store.js';
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

  registerImportCommand(program, async (options) => {
    const { render } = await import('ink');
    const { runApp } = await import('./app.js');
    await runApp(render, options);
  });
  registerForwardedCommands(program);

  program.hook('preAction', async (_thisCommand, actionCommand) => {
    const chain: string[] = [];
    for (let c: Command | null = actionCommand; c && c.parent; c = c.parent) chain.unshift(c.name());
    const commandChain = chain.join(' ') || actionCommand.name();
    const { enabled } = await readAnalyticsSetting();
    setPersistedAnalyticsDisabled(!enabled);
    setCliVersion(pkg.version);
    noteCommandStart(commandChain);
  });

  program.hook('postAction', async () => {
    await completeActiveCommand();
    await flushAnalytics();
  });

  // Surface uncaught failures as a terminal `failed` event. Node won't await
  // on-exit async hooks, so flush must happen before the process exits.
  process.on('unhandledRejection', async (error: unknown) => {
    await failActiveCommand({
      error_name: error instanceof Error ? error.name : 'UnhandledRejection',
      exit_code: 1,
    });
    await flushAnalytics();
    process.exit(1);
  });

  return program;
}
