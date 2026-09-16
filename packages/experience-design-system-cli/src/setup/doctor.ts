import { join } from 'node:path';
import { readExperiencesCredentials } from '../credentials-store.js';
import { findPkgRoot } from '../lib/cli-path.js';
import { AGENT_DEFS } from './agents.js';
import { REQUIRED_NODE_MAJOR, binaryExists, pathExists, runSpawn } from './shell.js';

// `doctor` streams its findings as they happen rather than repainting a screen,
// so it writes ANSI directly instead of mounting the Ink setup UI.

function ok(msg: string): void {
  process.stdout.write(`  \x1b[32m\u2713\x1b[0m  ${msg}\n`);
}

function fail(msg: string): void {
  process.stdout.write(`  \x1b[31m\u2717\x1b[0m  ${msg}\n`);
}

function warn(msg: string): void {
  process.stdout.write(`  \x1b[33m\u26a0\x1b[0m  ${msg}\n`);
}

function info(msg: string): void {
  process.stdout.write(`     ${msg}\n`);
}

function section(title: string): void {
  process.stdout.write(`\n\x1b[1m${title}\x1b[0m\n`);
}

export interface DoctorOptions {
  skipBuild?: boolean;
  skipAgent?: boolean;
}

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

  const nodeModulesExists = await pathExists(join(pkgRoot, 'node_modules'));

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

export async function runDoctor(opts: DoctorOptions): Promise<void> {
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
    process.stderr.write('\n\x1b[32m\x1b[1m✓ All checks passed. You are ready to run: experiences import\x1b[0m\n\n');
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
}
