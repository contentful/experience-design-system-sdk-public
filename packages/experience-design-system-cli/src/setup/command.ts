import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { appendFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Command } from 'commander';
import {
  readExperiencesCredentials,
  writeExperiencesCredentials,
  experiencesCredentialsPath,
} from '../credentials-store.js';
import { findPkgRoot } from '../lib/cli-path.js';
import { getInteractiveTerminalSupport } from '../lib/terminal-capabilities.js';
import type { AgentName } from '@contentful/experience-design-system-generation';
import type { SetupOutcome, SetupScreenDependencies, SetupSkipFlags } from './tui/SetupScreen.js';

const execFileAsync = promisify(execFile);

const REQUIRED_NODE_MAJOR = 24;

export const SETUP_REQUIRES_TTY_MESSAGE = 'Error: experiences setup requires an interactive terminal.';

// ── Output helpers ────────────────────────────────────────────────────────────

function ok(msg: string): void {
  process.stdout.write(`  \x1b[32m✓\x1b[0m  ${msg}\n`);
}

function fail(msg: string): void {
  process.stdout.write(`  \x1b[31m✗\x1b[0m  ${msg}\n`);
}

function warn(msg: string): void {
  process.stdout.write(`  \x1b[33m⚠\x1b[0m  ${msg}\n`);
}

function info(msg: string): void {
  process.stdout.write(`     ${msg}\n`);
}

function section(title: string, tag?: '[required]' | '[optional]'): void {
  const tagStr = tag ? (tag === '[required]' ? `  \x1b[31m[required]\x1b[0m` : `  \x1b[2m[optional]\x1b[0m`) : '';
  process.stdout.write(`\n\x1b[1m${title}\x1b[0m${tagStr}\n`);
}

export function getCliVersion(): string {
  const pkg = JSON.parse(readFileSync(join(findPkgRoot(), 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

// ── Shell helpers ─────────────────────────────────────────────────────────────

async function binaryExists(name: string): Promise<boolean> {
  try {
    await execFileAsync('which', [name]);
    return true;
  } catch {
    return false;
  }
}

function runSpawn(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let settled = false;
    let stdout = '';
    let stderr = '';
    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        resolve({ exitCode: 1, stdout: '', stderr: err.message });
      }
    });
    child.stdout.on('data', (d: Buffer) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += String(d);
    });
    child.on('exit', (code) => {
      if (!settled) {
        settled = true;
        resolve({ exitCode: code ?? 1, stdout, stderr });
      }
    });
  });
}

/**
 * The environment- and disk-backed half of the setup actions. Prompts and
 * output stay with the Ink screen, which supplies the rest.
 */
export function createSetupScreenDependencies(): SetupScreenDependencies {
  return {
    nodeVersion: process.versions.node,
    homeDir: homedir(),
    env: process.env,
    binaryExists,
    run: runSpawn,
    pathExists: async (path) =>
      access(path)
        .then(() => true)
        .catch(() => false),
    profileContains,
    appendToProfile,
    readCredentials: readExperiencesCredentials,
    writeCredentials: writeExperiencesCredentials,
    credentialsPath: experiencesCredentialsPath,
  };
}

// ── Shell profile detection ───────────────────────────────────────────────────

async function detectShellProfile(): Promise<string> {
  const shell = process.env['SHELL'] ?? '';
  const home = homedir();

  if (shell.includes('zsh')) {
    return join(home, '.zshrc');
  }
  if (shell.includes('bash')) {
    // Prefer .bash_profile on macOS (login shell), .bashrc on Linux
    const bashProfile = join(home, '.bash_profile');
    const exists = await access(bashProfile)
      .then(() => true)
      .catch(() => false);
    return exists ? bashProfile : join(home, '.bashrc');
  }
  if (shell.includes('fish')) {
    return join(home, '.config', 'fish', 'config.fish');
  }
  return join(home, '.profile');
}

async function profileContains(profilePath: string, str: string): Promise<boolean> {
  try {
    const content = await readFile(profilePath, 'utf8');
    return content.includes(str);
  } catch {
    return false;
  }
}

async function appendToProfile(profilePath: string, lines: string): Promise<void> {
  await appendFile(profilePath, `\n${lines}\n`, 'utf8');
}

// ── Doctor checks ─────────────────────────────────────────────────────────────

const AGENT_DEFS: Array<{ name: string; binary: AgentName; installHint: string }> = [
  { name: 'Claude Code', binary: 'claude', installHint: 'npm install -g @anthropic-ai/claude-code && claude login' },
  { name: 'OpenAI Codex', binary: 'codex', installHint: 'npm install -g @openai/codex  (requires OPENAI_API_KEY)' },
  { name: 'OpenCode', binary: 'opencode', installHint: 'npm install -g opencode-ai && opencode auth' },
  { name: 'GitHub Copilot', binary: 'copilot', installHint: 'npm install -g @github/copilot && copilot' },
];

async function checkNode(): Promise<boolean> {
  section('Checking Node.js version');

  const current = process.versions.node;
  const major = parseInt(current.split('.')[0]!, 10);

  if (major < REQUIRED_NODE_MAJOR) {
    fail(`Node.js v${current} — need v${REQUIRED_NODE_MAJOR}+`);
    info('');
    info('How to fix:');
    if (await binaryExists('nvm')) {
      info(`  nvm install ${REQUIRED_NODE_MAJOR}`);
      info(`  nvm use ${REQUIRED_NODE_MAJOR}`);
      info(`  nvm alias default ${REQUIRED_NODE_MAJOR}   # make it permanent`);
    } else if (await binaryExists('fnm')) {
      info(`  fnm install ${REQUIRED_NODE_MAJOR}`);
      info(`  fnm use ${REQUIRED_NODE_MAJOR}`);
    } else {
      info(`  Download Node v${REQUIRED_NODE_MAJOR} from https://nodejs.org`);
    }
    return false;
  }

  ok(`Node.js v${current}`);
  return true;
}

async function checkPnpm(pkgRoot: string): Promise<boolean> {
  section('Checking pnpm');

  if (!(await binaryExists('pnpm'))) {
    fail('pnpm not found');
    info('How to fix:');
    info('  npm install -g pnpm');
    info('  # or: corepack enable pnpm');
    return false;
  }

  const versionResult = await runSpawn('pnpm', ['--version']);
  if (versionResult.exitCode !== 0) {
    fail('pnpm found but not working');
    info('Try reinstalling: npm install -g pnpm --force');
    return false;
  }

  ok(`pnpm v${versionResult.stdout.trim()}`);

  const pingResult = await runSpawn('pnpm', ['exec', 'node', '--version'], { cwd: pkgRoot });
  if (pingResult.exitCode !== 0) {
    fail('pnpm cannot execute in repo root');
    info('The pnpm global store may be mismatched with your current Node version.');
    info('How to fix:');
    info('  npm install -g pnpm --force');
    return false;
  }

  return true;
}

async function checkDependencies(pkgRoot: string): Promise<boolean> {
  section('Checking dependencies (pnpm install)');

  const nodeModulesExists = await access(join(pkgRoot, 'node_modules'))
    .then(() => true)
    .catch(() => false);

  if (!nodeModulesExists) {
    info('node_modules not found — running pnpm install...');
  } else {
    info('Running pnpm install to ensure dependencies are up to date...');
  }

  const repoRoot = join(pkgRoot, '..', '..');
  const result = await runSpawn('pnpm', ['install', '--frozen-lockfile'], { cwd: repoRoot });

  if (result.exitCode !== 0) {
    fail('pnpm install failed');
    info('');
    const errLines = result.stderr.trim().split('\n').slice(0, 10);
    for (const line of errLines) info(line);
    info('');
    info('How to fix:');
    info('  • Try: pnpm install (without --frozen-lockfile) to update the lockfile');
    info('  • Check that your Node version matches: cat .nvmrc');
    return false;
  }

  ok('Dependencies installed');
  return true;
}

async function checkBuild(pkgRoot: string): Promise<boolean> {
  section('Building CLI');

  info('Running pnpm build...');

  const repoRoot = join(pkgRoot, '..', '..');
  const result = await runSpawn('pnpm', ['--filter', '@contentful/experience-design-system-cli', 'run', 'build'], {
    cwd: repoRoot,
  });

  if (result.exitCode !== 0) {
    fail('Build failed');
    info('');
    const errLines = result.stderr.trim().split('\n').slice(0, 15);
    for (const line of errLines) info(line);
    info('');
    info('How to fix:');
    info('  • Check for TypeScript errors: pnpm typecheck');
    info('  • If the error is in a generated file under dist/, try: pnpm clean && pnpm build');
    return false;
  }

  ok('Build succeeded');
  return true;
}

async function checkAgent(): Promise<boolean> {
  section('Checking coding agent');

  const agents = AGENT_DEFS;

  const creds = await readExperiencesCredentials();
  const savedAgent = creds.agent;
  const savedModel = creds.agentModel;

  if (savedAgent) {
    const found = await binaryExists(savedAgent);
    if (found) {
      const modelStr = savedModel ? ` — model: ${savedModel}` : '';
      ok(`${savedAgent}${modelStr} (saved preference)`);
      return true;
    } else {
      warn(`Saved agent '${savedAgent}' not found on PATH`);
      info(`Re-run experiences setup to reconfigure.`);
      return false;
    }
  }

  for (const agent of agents) {
    if (await binaryExists(agent.binary)) {
      ok(`${agent.name} (${agent.binary}) found`);
      info('Tip: run experiences setup to save a default agent and model.');
      return true;
    }
  }

  warn('No coding agent found on PATH');
  info('The coding agent is required for the generate steps in experiences import.');
  info('Install one of:');
  info('  • Claude Code:   npm install -g @anthropic-ai/claude-code');
  info('  • OpenAI Codex:  npm install -g @openai/codex');
  info('  • OpenCode:      npm install -g opencode-ai');
  return false;
}

// ── Commands ──────────────────────────────────────────────────────────────────

export function registerSetupCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check prerequisites so experiences import runs without errors')
    .option('--skip-build', 'Skip the pnpm install + build step (useful if already built)')
    .option('--skip-agent', 'Skip the coding agent check')
    .action(async (opts: { skipBuild?: boolean; skipAgent?: boolean }) => {
      process.stderr.write('\x1b[1mexperiences doctor\x1b[0m — checking your environment\n');

      const pkgRoot = findPkgRoot();

      const results: { name: string; ok: boolean; required: boolean }[] = [];

      const nodeOk = await checkNode();
      results.push({ name: 'Node.js version', ok: nodeOk, required: true });

      if (nodeOk) {
        const pnpmOk = await checkPnpm(pkgRoot);
        results.push({ name: 'pnpm', ok: pnpmOk, required: true });

        if (!opts.skipBuild) {
          if (pnpmOk) {
            const depsOk = await checkDependencies(pkgRoot);
            results.push({ name: 'dependencies', ok: depsOk, required: true });

            if (depsOk) {
              const buildOk = await checkBuild(pkgRoot);
              results.push({ name: 'build', ok: buildOk, required: true });
            }
          }
        } else {
          info('\nSkipping install + build (--skip-build)');
        }
      }

      if (!opts.skipAgent) {
        const agentOk = await checkAgent();
        results.push({ name: 'coding agent', ok: agentOk, required: false });
      }

      section('Summary');
      const failed = results.filter((r) => !r.ok);
      const requiredFailed = failed.filter((r) => r.required);

      for (const r of results) {
        if (r.ok) {
          ok(r.name);
        } else if (r.required) {
          fail(`${r.name} — required`);
        } else {
          warn(`${r.name} — optional`);
        }
      }

      if (requiredFailed.length === 0 && failed.length === 0) {
        process.stderr.write(
          '\n\x1b[32m\x1b[1m✓ All checks passed. You are ready to run: experiences import\x1b[0m\n\n',
        );
        process.exit(0);
      } else if (requiredFailed.length === 0) {
        process.stderr.write('\n\x1b[33m\x1b[1m⚠ Required checks passed, but optional checks failed.\x1b[0m\n');
        process.stderr.write(
          '  You can run \x1b[1mexperiences import\x1b[0m but the generate steps may fail without a coding agent.\n\n',
        );
        process.exit(0);
      } else {
        process.stderr.write(
          `\n\x1b[31m\x1b[1m✗ ${requiredFailed.length} required check${requiredFailed.length === 1 ? '' : 's'} failed.\x1b[0m\n`,
        );
        process.stderr.write('  Fix the issues above, then re-run \x1b[1mexperiences doctor\x1b[0m.\n\n');
        process.exit(1);
      }
    });

  program
    .command('setup')
    .description('Interactive setup wizard: installs prerequisites and configures credentials for experiences import')
    .option('--skip-build', 'Skip the pnpm install + build step')
    .option('--skip-agent', 'Skip the coding agent check')
    .option('--skip-credentials', 'Skip the Contentful credentials step')
    .option('--skip-optional', 'Skip optional quality-of-life extras')
    .action(async (opts: SetupSkipFlags) => {
      // Setup is Ink-only: there is no second non-interactive implementation.
      if (!getInteractiveTerminalSupport().supported) {
        process.stderr.write(`${SETUP_REQUIRES_TTY_MESSAGE}\n`);
        process.exit(1);
        return;
      }

      const { render } = await import('ink');
      const { createElement } = await import('react');
      const { SetupScreen } = await import('./tui/SetupScreen.js');

      const pkgRoot = findPkgRoot();
      const repoRoot = join(pkgRoot, '..', '..');
      const profilePath = await detectShellProfile();

      const completion: { outcome: SetupOutcome | null } = { outcome: null };
      let unmountInk: (() => void) | null = null;

      const { waitUntilExit, unmount } = render(
        createElement(SetupScreen, {
          version: getCliVersion(),
          repoRoot,
          profilePath,
          dependencies: createSetupScreenDependencies(),
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
        const cliBin = process.argv[1] ?? fileURLToPath(import.meta.url);
        const doctorResult = await runSpawn(process.execPath, [cliBin, 'doctor'], { env: process.env });
        process.stdout.write(doctorResult.stdout);
        process.stderr.write(doctorResult.stderr);
        process.exit(doctorResult.exitCode);
        return;
      }

      process.stdout.write('\nRun \x1b[1mexperiences doctor\x1b[0m at any time to re-check your environment.\n\n');
      process.exit(finished.exitCode);
    });
}
