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

const require = createRequire(import.meta.url);

const pkg = require('../package.json') as { version: string };

function registerBuildCommand(program: Command): void {
  program
    .command('build')
    .description('Rebuild from source and re-link exo/experiences binaries to this build')
    .action(async () => {
      const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
      process.stderr.write('⚙  Building from source...\n');
      const exitCode = await new Promise<number>((resolvePromise) => {
        const child = spawn('pnpm', ['build'], { cwd: pkgRoot, stdio: 'inherit' });
        child.on('error', () => resolvePromise(1));
        child.on('exit', (code) => resolvePromise(code ?? 1));
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
  registerBuildCommand(program);

  return program;
}
