import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { findPkgRoot } from '../lib/cli-path.js';
import { getInteractiveTerminalSupport } from '../lib/terminal-capabilities.js';
import { detectShellProfile, runSpawn } from './lib/shell.js';
import type { SetupOutcome, SetupSkipFlags } from './SetupScreen.js';

export const SETUP_REQUIRES_TTY_MESSAGE = 'Error: experiences setup requires an interactive terminal.';

export function getCliVersion(): string {
  const pkg = JSON.parse(readFileSync(join(findPkgRoot(), 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

async function runSetup(opts: SetupSkipFlags): Promise<void> {
  // Setup is Ink-only: there is no second non-interactive implementation.
  if (!getInteractiveTerminalSupport().supported) {
    process.stderr.write(`${SETUP_REQUIRES_TTY_MESSAGE}\n`);
    process.exit(1);
    return;
  }

  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { SetupScreen } = await import('./SetupScreen.js');

  const repoRoot = join(findPkgRoot(), '..', '..');
  const profilePath = await detectShellProfile();

  const completion: { outcome: SetupOutcome | null } = { outcome: null };
  let unmountInk: (() => void) | null = null;

  const { waitUntilExit, unmount } = render(
    createElement(SetupScreen, {
      version: getCliVersion(),
      repoRoot,
      profilePath,
      skip: {
        ...(opts.skipBuild !== undefined ? { skipBuild: opts.skipBuild } : {}),
        ...(opts.skipAgent !== undefined ? { skipAgent: opts.skipAgent } : {}),
        ...(opts.skipCredentials !== undefined ? { skipCredentials: opts.skipCredentials } : {}),
        ...(opts.skipOptional !== undefined ? { skipOptional: opts.skipOptional } : {}),
      },
      offerDoctor: true,
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
    return;
  }

  if (finished.runDoctor) {
    // Doctor runs in a fresh process so it inherits the environment setup just
    // configured, rather than this process's stale copy.
    const cliBin = process.argv[1] ?? fileURLToPath(import.meta.url);
    const doctorResult = await runSpawn(process.execPath, [cliBin, 'doctor'], { env: process.env });
    process.stdout.write(doctorResult.stdout);
    process.stderr.write(doctorResult.stderr);
    process.exit(doctorResult.exitCode);
    return;
  }

  process.stdout.write('\nRun \x1b[1mexperiences doctor\x1b[0m at any time to re-check your environment.\n\n');
  process.exit(finished.exitCode);
}

export function registerSetupCommand(program: Command): void {
  program
    .command('setup')
    .description('Interactive setup wizard: installs prerequisites and configures credentials for experiences import')
    .option('--skip-build', 'Skip the pnpm install + build step')
    .option('--skip-agent', 'Skip the coding agent check')
    .option('--skip-credentials', 'Skip the Contentful credentials step')
    .option('--skip-optional', 'Skip optional quality-of-life extras')
    .action((opts: SetupSkipFlags) => runSetup(opts));
}
