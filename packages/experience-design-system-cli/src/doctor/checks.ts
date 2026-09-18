import { homedir } from 'node:os';
import { join } from 'node:path';
import { readExperiencesCredentials } from '../credentials-store.js';
import { AGENT_DEFS } from '../lib/agent-definitions.js';
import { binaryExists, pathExists } from '../setup/lib/shell.js';
import {
  buildCli,
  checkNodeVersion,
  checkPnpm,
  detectNodeVersionManagers,
  installDependencies,
} from '../setup/lib/checks.js';
import { fail, info, infoStderr, ok, section, warn } from './report.js';

export async function reportNode(): Promise<boolean> {
  section('Checking Node.js version');

  const check = checkNodeVersion();
  if (check.passed) {
    ok(`Node.js v${check.version}`);
    return true;
  }

  fail(`Node.js v${check.version} — need v${check.required}+`);
  info('');
  info('How to fix:');
  const managers = await detectNodeVersionManagers(homedir());
  if (managers.nvm) {
    info(`  nvm install ${check.required}`);
    info(`  nvm use ${check.required}`);
    info(`  nvm alias default ${check.required}   # make it permanent`);
  } else if (managers.fnm) {
    info(`  fnm install ${check.required}`);
    info(`  fnm use ${check.required}`);
  } else {
    info(`  Download Node v${check.required} from https://nodejs.org`);
  }
  return false;
}

export async function reportPnpm(pkgRoot: string): Promise<boolean> {
  section('Checking pnpm');

  const check = await checkPnpm(pkgRoot);
  if (check.status === 'missing') {
    fail('pnpm not found');
    info('How to fix:');
    info('  npm install -g pnpm');
    info('  # or: corepack enable pnpm');
    return false;
  }
  if (check.status === 'broken') {
    fail('pnpm found but not working');
    info('Try reinstalling: npm install -g pnpm --force');
    return false;
  }

  ok(`pnpm v${check.version}`);

  if (check.status === 'unusable-in-repo') {
    fail('pnpm cannot execute in repo root');
    info('The pnpm global store may be mismatched with your current Node version.');
    info('How to fix:');
    info('  npm install -g pnpm --force');
    return false;
  }

  return true;
}

export async function reportDependencies(pkgRoot: string): Promise<boolean> {
  section('Checking dependencies (pnpm install)');

  // The wording depends on whether node_modules existed, so it is checked here
  // rather than read back from the install result after the fact.
  if (!(await pathExists(join(pkgRoot, 'node_modules')))) {
    info('node_modules not found — running pnpm install...');
  } else {
    info('Running pnpm install to ensure dependencies are up to date...');
  }

  const check = await installDependencies(join(pkgRoot, '..', '..'));
  if (!check.passed) {
    fail('pnpm install failed');
    info('');
    infoStderr(check.result.stderr, 10);
    info('');
    info('How to fix:');
    info('  • Try: pnpm install (without --frozen-lockfile) to update the lockfile');
    info('  • Check that your Node version matches: cat .nvmrc');
    return false;
  }

  ok('Dependencies installed');
  return true;
}

export async function reportBuild(pkgRoot: string): Promise<boolean> {
  section('Building CLI');

  info('Running pnpm build...');

  const check = await buildCli(join(pkgRoot, '..', '..'));
  if (!check.passed) {
    fail('Build failed');
    info('');
    infoStderr(check.result.stderr, 15);
    info('');
    info('How to fix:');
    info('  • Check for TypeScript errors: pnpm typecheck');
    info('  • If the error is in a generated file under dist/, try: pnpm clean && pnpm build');
    return false;
  }

  ok('Build succeeded');
  return true;
}

export async function reportAgent(): Promise<boolean> {
  section('Checking coding agent');

  const creds = await readExperiencesCredentials();
  const savedAgent = creds.agent;
  const savedModel = creds.agentModel;

  if (savedAgent) {
    if (await binaryExists(savedAgent)) {
      const modelStr = savedModel ? ` — model: ${savedModel}` : '';
      ok(`${savedAgent}${modelStr} (saved preference)`);
      return true;
    }
    warn(`Saved agent '${savedAgent}' not found on PATH`);
    info(`Re-run experiences setup to reconfigure.`);
    return false;
  }

  for (const agent of AGENT_DEFS) {
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
