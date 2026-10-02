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
      const { createElement } = await import('react');
      const { App } = await import('./app.js');
      const { spawnV1Import } = await import('./src/tui/import/spawn-v1-import.js');

      let importExitCode: number | undefined;
      for (;;) {
        let launchImport = false;
        const instance = render(
          createElement(App, {
            importExitCode,
            onLaunchImport: () => {
              launchImport = true;
              instance.unmount();
            },
          }),
        );
        await instance.waitUntilExit();
        if (!launchImport) return;

        // v1 inherits the terminal, so v2's Ink app must be fully unmounted while
        // it runs. Otherwise both read the same stdin and keypresses get split.
        importExitCode = (await spawnV1Import({})).exitCode;
      }
    });

  return program;
}
