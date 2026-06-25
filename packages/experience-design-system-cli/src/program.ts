import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import { registerAnalyzeCommand } from './analyze/command.js';
import { registerGenerateCommand } from './generate/command.js';
import { registerApplyCommand } from './apply/command.js';
import { registerSessionCommand } from './session/command.js';
import { registerPrintCommand } from './print/command.js';
import { registerImportCommand } from './import/command.js';
import { registerSetupCommand } from './setup/command.js';
import { registerRunsCommand } from './runs/ls-command.js';
import { registerExportCommand } from './runs/export-command.js';

const require = createRequire(import.meta.url);

const pkg = require('../package.json') as { version: string };

type SpawnedChild = {
  on(event: 'error', listener: (err: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
};

/**
 * Run the spawn lifecycle for the build command. Extracted so the
 * error-surfacing path is testable: previously `child.on('error', ...)`
 * silently returned exit code 1 with no context, leaving the user
 * staring at a generic non-zero exit when `pnpm` wasn't on PATH.
 */
export async function runBuild(opts: {
  spawnFn: () => SpawnedChild;
  stderrWrite: (chunk: string) => void;
}): Promise<{ exitCode: number }> {
  return new Promise((resolvePromise) => {
    const child = opts.spawnFn();
    let settled = false;
    const settle = (exitCode: number): void => {
      if (settled) return;
      settled = true;
      resolvePromise({ exitCode });
    };
    child.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      opts.stderrWrite(`Error: failed to spawn build subprocess: ${message}\n`);
      settle(1);
    });
    child.on('exit', (code) => settle(code ?? 1));
  });
}

function registerBuildCommand(program: Command): void {
  program
    .command('build')
    .description('Rebuild from source and re-link exo/experiences binaries to this build')
    .action(async () => {
      const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
      process.stderr.write('⚙  Building from source...\n');
      const { exitCode } = await runBuild({
        spawnFn: () => spawn('pnpm', ['build'], { cwd: pkgRoot, stdio: 'inherit' }) as SpawnedChild,
        stderrWrite: (s) => process.stderr.write(s),
      });
      process.exit(exitCode);
    });
}

export function createProgram(): Command {
  const program = new Command()
    .name('experience-design-system-cli')
    .description('Static analysis, validation, generation, and import of Contentful design system artifacts')
    .version(pkg.version, '--version', 'Print version number');

  registerAnalyzeCommand(program);
  registerGenerateCommand(program);
  registerPrintCommand(program);
  registerApplyCommand(program);
  registerSessionCommand(program);
  registerImportCommand(program);
  registerSetupCommand(program);
  registerRunsCommand(program);
  registerExportCommand(program);
  registerBuildCommand(program);

  return program;
}
