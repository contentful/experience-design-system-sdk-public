import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { findPkgRoot } from '../lib/cli-path.js';
import { getInteractiveTerminalSupport } from '../lib/terminal-capabilities.js';
import type { SetupOutcome, SetupSkipFlags } from './SetupScreen.js';

export const SETUP_REQUIRES_TTY_MESSAGE = 'Error: experiences setup requires an interactive terminal.';

function getCliVersion(): string {
  const pkg = JSON.parse(readFileSync(join(findPkgRoot(), 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

async function runSetup(opts: SetupSkipFlags): Promise<void> {
  // Setup is Ink-only: there is no second non-interactive implementation.
  if (!getInteractiveTerminalSupport().supported) {
    process.stderr.write(`${SETUP_REQUIRES_TTY_MESSAGE}\n`);
    process.exit(1);
  }

  const { renderWithGoodbye } = await import('../tui/render-with-goodbye.js');
  const { createElement } = await import('react');
  const { SetupScreen } = await import('./SetupScreen.js');

  const repoRoot = join(findPkgRoot(), '..', '..');

  const completion: { outcome: SetupOutcome | null } = { outcome: null };
  let unmountInk: (() => void) | null = null;

  const { waitUntilExit, unmount } = renderWithGoodbye(
    createElement(SetupScreen, {
      version: getCliVersion(),
      repoRoot,
      skip: {
        ...(opts.skipBuild !== undefined ? { skipBuild: opts.skipBuild } : {}),
        ...(opts.skipAgent !== undefined ? { skipAgent: opts.skipAgent } : {}),
        ...(opts.skipCredentials !== undefined ? { skipCredentials: opts.skipCredentials } : {}),
        ...(opts.skipOptional !== undefined ? { skipOptional: opts.skipOptional } : {}),
      },
      onComplete: (result) => {
        completion.outcome = result;
        unmountInk?.();
      },
    }),
  );
  unmountInk = unmount;
  await waitUntilExit();

  const finished = completion.outcome;
  if (!finished) {
    process.exit(1);
  }

  process.exit(finished.exitCode);
}

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Interactive setup: installs prerequisites and configures credentials for experiences import')
    .helpOption(false)
    .action(() => runSetup({}));
}
