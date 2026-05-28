import { execFile, spawn } from 'node:child_process';
import { appendFile, readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import type { Command } from 'commander';
import { readExperiencesCredentials, writeExperiencesCredentials, experiencesCredentialsPath } from '../credentials-store.js';

const execFileAsync = promisify(execFile);

const REQUIRED_NODE_MAJOR = 24;

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

function dim(msg: string): void {
  process.stdout.write(`\x1b[2m${msg}\x1b[0m\n`);
}

// ── Prompt helpers ────────────────────────────────────────────────────────────

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptSecret(question: string): Promise<string> {
  // Use readline for all prompts — mixing raw-mode stdin listeners with
  // readline createInterface causes readline to buffer+unshift unconsumed
  // input back onto the stream, which the raw listener then re-reads,
  // doubling the typed value. Using readline throughout avoids this entirely.
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: process.stdin.isTTY,
    });
    let value = '';
    process.stdout.write(question);
    if (process.stdin.isTTY) {
      // Intercept the readline output write so we can replace echoed chars with *
      const origWrite = (rl as unknown as { output: { write: (s: string) => void } }).output.write.bind(
        (rl as unknown as { output: NodeJS.WriteStream }).output,
      );
      (rl as unknown as { output: { write: (s: string) => void } }).output.write = (s: string) => {
        // Allow newline through; suppress everything else (the echoed characters)
        if (s === '\r\n' || s === '\n' || s === '\r') origWrite(s);
      };
    }
    rl.on('line', (line) => {
      value = line;
      rl.close();
    });
    rl.once('close', () => {
      process.stdout.write('\n');
      resolve(value);
    });
  });
}

async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await prompt(`  ${question} ${hint} `);
  if (!answer) return defaultYes;
  return answer.toLowerCase().startsWith('y');
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

// ── Step 1: Node.js ───────────────────────────────────────────────────────────

async function setupNode(): Promise<boolean> {
  section('Step 1: Node.js', '[required]');

  const current = process.versions.node;
  const major = parseInt(current.split('.')[0]!, 10);

  if (major >= REQUIRED_NODE_MAJOR) {
    ok(`Node.js v${current} — already good`);
    return true;
  }

  fail(`Node.js v${current} — need v${REQUIRED_NODE_MAJOR}+`);
  info('');

  const hasNvm =
    (await binaryExists('nvm')) ||
    (await access(join(homedir(), '.nvm', 'nvm.sh'))
      .then(() => true)
      .catch(() => false));
  const hasFnm = await binaryExists('fnm');

  if (hasNvm) {
    info(`nvm detected. Will run: nvm install ${REQUIRED_NODE_MAJOR} && nvm use ${REQUIRED_NODE_MAJOR}`);
    const go = await confirm(`Install and switch to Node ${REQUIRED_NODE_MAJOR} via nvm?`);
    if (!go) {
      warn(`Skipped. Re-run experiences setup after switching to Node ${REQUIRED_NODE_MAJOR}.`);
      return false;
    }
    // nvm is a shell function so we source it and run in a subshell
    const nvmScript = join(homedir(), '.nvm', 'nvm.sh');
    const result = await runSpawn('bash', [
      '-c',
      `source "${nvmScript}" && nvm install ${REQUIRED_NODE_MAJOR} && nvm alias default ${REQUIRED_NODE_MAJOR}`,
    ]);
    if (result.exitCode !== 0) {
      fail('nvm install failed');
      info(result.stderr.trim().split('\n').slice(0, 5).join('\n'));
      info(`Run manually: nvm install ${REQUIRED_NODE_MAJOR} && nvm use ${REQUIRED_NODE_MAJOR}`);
      return false;
    }
    ok(`Node ${REQUIRED_NODE_MAJOR} installed via nvm. Re-run experiences setup in a fresh shell to pick it up.`);
    return false; // Need fresh shell to get the new node on PATH
  }

  if (hasFnm) {
    info(`fnm detected. Will run: fnm install ${REQUIRED_NODE_MAJOR} && fnm use ${REQUIRED_NODE_MAJOR}`);
    const go = await confirm(`Install and switch to Node ${REQUIRED_NODE_MAJOR} via fnm?`);
    if (!go) {
      warn(`Skipped. Re-run experiences setup after switching to Node ${REQUIRED_NODE_MAJOR}.`);
      return false;
    }
    const result = await runSpawn('fnm', ['install', String(REQUIRED_NODE_MAJOR)]);
    if (result.exitCode !== 0) {
      fail('fnm install failed');
      info(`Run manually: fnm install ${REQUIRED_NODE_MAJOR} && fnm use ${REQUIRED_NODE_MAJOR}`);
      return false;
    }
    const useResult = await runSpawn('fnm', ['use', String(REQUIRED_NODE_MAJOR)]);
    if (useResult.exitCode !== 0) {
      warn(`fnm use ${REQUIRED_NODE_MAJOR} failed — node installed but not activated`);
      info(`Run manually: fnm use ${REQUIRED_NODE_MAJOR} && fnm default ${REQUIRED_NODE_MAJOR}`);
    } else {
      const defaultResult = await runSpawn('fnm', ['default', String(REQUIRED_NODE_MAJOR)]);
      if (defaultResult.exitCode !== 0) {
        warn(`fnm default ${REQUIRED_NODE_MAJOR} failed — version won't persist across new shells`);
        info(`Run manually: fnm default ${REQUIRED_NODE_MAJOR}`);
      }
    }
    ok(`Node ${REQUIRED_NODE_MAJOR} installed via fnm. Re-run experiences setup in a fresh shell.`);
    return false;
  }

  // No version manager found — offer to install nvm
  info('No Node version manager detected (nvm or fnm).');
  const installNvm = await confirm('Install nvm now? (recommended)');
  if (installNvm) {
    info('Running nvm install script...');
    const result = await runSpawn('bash', [
      '-c',
      'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash',
    ]);
    if (result.exitCode !== 0) {
      fail('nvm install failed');
      info('Install manually: https://github.com/nvm-sh/nvm#installing-and-updating');
      return false;
    }
    ok('nvm installed. Open a new shell, then re-run experiences setup.');
    return false;
  }

  info(`Install Node ${REQUIRED_NODE_MAJOR} manually from https://nodejs.org`);
  return false;
}

// ── Step 2: pnpm ─────────────────────────────────────────────────────────────

async function setupPnpm(): Promise<boolean> {
  section('Step 2: pnpm', '[required]');

  if (await binaryExists('pnpm')) {
    const v = await runSpawn('pnpm', ['--version']);
    ok(`pnpm v${v.stdout.trim()} — already installed`);
    return true;
  }

  fail('pnpm not found');
  info('');

  const hasCorecpack = await binaryExists('corepack');
  if (hasCorecpack) {
    info('Will run: corepack enable && corepack prepare pnpm@latest --activate');
    const go = await confirm('Install pnpm via corepack?');
    if (go) {
      const r1 = await runSpawn('corepack', ['enable']);
      const r2 = r1.exitCode === 0 ? await runSpawn('corepack', ['prepare', 'pnpm@latest', '--activate']) : r1;
      if (r2.exitCode !== 0) {
        fail('corepack install failed');
        info('Try: npm install -g pnpm');
        return false;
      }
      ok('pnpm installed via corepack');
      return true;
    }
  }

  info('Will run: npm install -g pnpm');
  const go = await confirm('Install pnpm via npm?');
  if (!go) {
    warn('Skipped. Install pnpm manually: npm install -g pnpm');
    return false;
  }

  const result = await runSpawn('npm', ['install', '-g', 'pnpm']);
  if (result.exitCode !== 0) {
    fail('npm install -g pnpm failed');
    info(result.stderr.trim().split('\n').slice(0, 5).join('\n'));
    return false;
  }

  ok('pnpm installed');
  return true;
}

// ── Step 3: install + build ───────────────────────────────────────────────────

async function setupBuild(repoRoot: string): Promise<boolean> {
  section('Step 3: Install dependencies & build', '[required]');

  info('Running pnpm install...');
  const installResult = await runSpawn('pnpm', ['install', '--frozen-lockfile'], { cwd: repoRoot });
  if (installResult.exitCode !== 0) {
    fail('pnpm install failed');
    const errLines = installResult.stderr.trim().split('\n').slice(0, 8);
    for (const line of errLines) info(line);
    info('');
    info('Try: pnpm install (without --frozen-lockfile) to update the lockfile');
    return false;
  }
  ok('Dependencies installed');

  info('Building CLI...');
  const buildResult = await runSpawn('pnpm', ['--filter', '@contentful/experience-design-system-cli', 'run', 'build'], {
    cwd: repoRoot,
  });
  if (buildResult.exitCode !== 0) {
    fail('Build failed');
    const errLines = buildResult.stderr.trim().split('\n').slice(0, 10);
    for (const line of errLines) info(line);
    return false;
  }

  ok('CLI built successfully');
  return true;
}

// ── Step 4: agent CLI ─────────────────────────────────────────────────────────

async function setupAgent(): Promise<boolean> {
  section('Step 4: Coding agent (claude, codex, opencode, or cursor)', '[required]');
  info('experiences import uses a coding agent to generate component definitions.');
  info('');

  const agents: Array<{ name: string; binary: string; installHint: string }> = [
    { name: 'Claude Code', binary: 'claude', installHint: 'npm install -g @anthropic-ai/claude-code && claude login' },
    { name: 'OpenAI Codex', binary: 'codex', installHint: 'npm install -g @openai/codex  (requires OPENAI_API_KEY)' },
    { name: 'OpenCode', binary: 'opencode', installHint: 'npm install -g opencode-ai && opencode auth' },
  ];

  for (const agent of agents) {
    if (await binaryExists(agent.binary)) {
      ok(`${agent.name} (${agent.binary}) found`);
      return true;
    }
  }

  warn('No coding agent found on PATH');
  info('');
  info('Choose one to install:');
  info('  [1] Claude Code (recommended) — npm install -g @anthropic-ai/claude-code');
  info('  [2] OpenAI Codex             — npm install -g @openai/codex');
  info('  [3] OpenCode                 — npm install -g opencode-ai');
  info('  [s] Skip for now');
  info('');

  const choice = await prompt('  Your choice: ');

  if (choice === '1' || choice === '') {
    const r = await runSpawn('npm', ['install', '-g', '@anthropic-ai/claude-code']);
    if (r.exitCode !== 0) {
      fail('Install failed');
      info(r.stderr.trim().split('\n').slice(0, 5).join('\n'));
      return false;
    }
    if (!(await binaryExists('claude'))) {
      fail('claude binary not found on PATH after install — check your npm global bin directory');
      return false;
    }
    ok('Claude Code installed');
    info('');
    info('Next: run `claude login` to authenticate (browser OAuth).');
    info('Or set ANTHROPIC_API_KEY in your shell profile.');
    return true;
  }

  if (choice === '2') {
    const r = await runSpawn('npm', ['install', '-g', '@openai/codex']);
    if (r.exitCode !== 0) {
      fail('Install failed');
      return false;
    }
    if (!(await binaryExists('codex'))) {
      fail('codex binary not found on PATH after install — check your npm global bin directory');
      return false;
    }
    ok('OpenAI Codex installed');
    info('Set OPENAI_API_KEY in your shell profile to authenticate.');
    return true;
  }

  if (choice === '3') {
    const r = await runSpawn('npm', ['install', '-g', 'opencode-ai']);
    if (r.exitCode !== 0) {
      fail('Install failed');
      return false;
    }
    if (!(await binaryExists('opencode'))) {
      fail('opencode binary not found on PATH after install — check your npm global bin directory');
      return false;
    }
    ok('OpenCode installed');
    info('Run `opencode auth` to configure your provider.');
    return true;
  }

  warn('Skipped. Install a coding agent before running experiences import.');
  return false;
}

// ── Step 5: Contentful credentials ───────────────────────────────────────────

async function setupContentfulCredentials(): Promise<boolean> {
  section('Step 5: Contentful credentials', '[optional]');
  info(`Saved to ${experiencesCredentialsPath()} — loaded automatically by experiences import.`);
  info('');

  const stored = await readExperiencesCredentials();
  const currentSpace = stored.spaceId;
  const currentEnv = stored.environmentId;
  const currentToken = stored.cmaToken;
  const hasAny = !!(currentSpace || currentEnv || currentToken);

  if (hasAny) {
    info('Current values:');
    if (currentSpace) {
      ok(`Space ID        ${currentSpace}`);
    } else {
      warn('Space ID        (not set)');
    }
    if (currentEnv) {
      ok(`Environment ID  ${currentEnv}`);
    } else {
      warn('Environment ID  (not set)');
    }
    if (currentToken) {
      ok(`CMA Token       ${'•'.repeat(Math.min(currentToken.length, 8))}...`);
    } else {
      warn('CMA Token       (not set)');
    }
    info('');
  }

  const allSet = !!(currentSpace && currentEnv && currentToken);
  const doUpdate = await confirm(hasAny ? 'Update credentials?' : 'Configure Contentful credentials?', !allSet);

  if (!doUpdate) {
    if (allSet) {
      ok('Credentials already configured — no changes made');
    } else {
      warn('Skipped. experiences import will prompt for credentials interactively.');
    }
    return true;
  }

  info('');
  info('Get your CMA token: Contentful web app → Settings → API keys → Content management tokens');
  info('');

  const spaceIdInput = await prompt(`  Space ID${currentSpace ? ` [${currentSpace}]` : ''}: `);
  const spaceId = spaceIdInput || currentSpace;

  const envIdInput = await prompt(`  Environment ID [${currentEnv || 'master'}]: `);
  const environmentId = envIdInput || currentEnv || 'master';

  const tokenInput = await promptSecret(
    `  CMA token${currentToken ? ' [press Enter to keep existing]' : ' (paste here)'}: `,
  );
  const cmaToken = tokenInput || currentToken;

  if (!cmaToken || !spaceId) {
    warn('Space ID and CMA token are required. Skipped.');
    return false;
  }

  await writeExperiencesCredentials({ spaceId, environmentId, cmaToken });
  ok(`Credentials saved to ${experiencesCredentialsPath()}`);
  info('Run experiences import — the credentials step will be pre-filled automatically.');

  return true;
}

// ── Step 6: Optional quality-of-life ─────────────────────────────────────────

async function setupQoL(profilePath: string): Promise<void> {
  section('Step 6: Optional extras', '[optional]');
  info('These are not required for experiences import but improve the experience.');
  info('');

  // 6a: EDS_EXTRACT_CONCURRENCY
  const hasConcurrency = await profileContains(profilePath, 'EDS_EXTRACT_CONCURRENCY');
  if (!hasConcurrency) {
    info('EDS_EXTRACT_CONCURRENCY — controls how many components are analyzed in parallel.');
    info('Default is 4. Set higher (e.g. 8) on fast machines to speed up large codebases.');
    const setConcurrency = await confirm('Add EDS_EXTRACT_CONCURRENCY=8 to your profile?', false);
    if (setConcurrency) {
      await appendToProfile(profilePath, '# experiences performance\nexport EDS_EXTRACT_CONCURRENCY=8');
      ok(`EDS_EXTRACT_CONCURRENCY=8 written to ${profilePath}`);
    } else {
      dim('     skipped');
    }
  } else {
    ok('EDS_EXTRACT_CONCURRENCY — already set');
  }

  // 6b: NO_COLOR
  info('');
  info('NO_COLOR — set to 1 to disable ANSI color output (useful in CI or plain terminals).');
  const setNoColor = await confirm('Add NO_COLOR=1 (disable colors) to your profile?', false);
  if (setNoColor) {
    const hasNoColor = await profileContains(profilePath, 'NO_COLOR');
    if (!hasNoColor) {
      await appendToProfile(profilePath, 'export NO_COLOR=1');
      ok(`NO_COLOR=1 written to ${profilePath}`);
    } else {
      warn('NO_COLOR already present in profile — skipping');
    }
  } else {
    dim('     skipped');
  }
}

// ── Doctor checks ─────────────────────────────────────────────────────────────

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

  const agents = [
    { name: 'Claude Code', binary: 'claude' },
    { name: 'OpenAI Codex', binary: 'codex' },
    { name: 'OpenCode', binary: 'opencode' },
  ];

  for (const agent of agents) {
    if (await binaryExists(agent.binary)) {
      ok(`${agent.name} (${agent.binary}) found`);
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

      const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

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
    });

  program
    .command('setup')
    .description('Interactive setup wizard: installs prerequisites and configures credentials for experiences import')
    .option('--skip-build', 'Skip the pnpm install + build step')
    .option('--skip-agent', 'Skip the coding agent check')
    .option('--skip-credentials', 'Skip the Contentful credentials step')
    .option('--skip-optional', 'Skip optional quality-of-life extras')
    .action(
      async (opts: { skipBuild?: boolean; skipAgent?: boolean; skipCredentials?: boolean; skipOptional?: boolean }) => {
        process.stdout.write('\n\x1b[1mexperiences setup\x1b[0m — interactive setup wizard\n');
        process.stdout.write('Sets up everything you need to run \x1b[1mexperiences import\x1b[0m.\n');
        process.stdout.write(
          'Required steps are marked \x1b[31m[required]\x1b[0m, optional ones \x1b[2m[optional]\x1b[0m.\n',
        );

        const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
        const repoRoot = join(pkgRoot, '..', '..');
        const profilePath = await detectShellProfile();

        const results: { name: string; passed: boolean; required: boolean }[] = [];

        // Step 1: Node
        const nodeOk = await setupNode();
        results.push({ name: 'Node.js 24+', passed: nodeOk, required: true });

        if (!nodeOk) {
          process.stdout.write(
            '\n\x1b[33mNode.js setup requires a shell restart. Re-run experiences setup afterwards.\x1b[0m\n\n',
          );
          process.exit(0);
        }

        // Step 2: pnpm
        const pnpmOk = await setupPnpm();
        results.push({ name: 'pnpm', passed: pnpmOk, required: true });

        // Step 3: install + build
        if (!opts.skipBuild && pnpmOk) {
          const buildOk = await setupBuild(repoRoot);
          results.push({ name: 'install & build', passed: buildOk, required: true });
        } else if (opts.skipBuild) {
          info('\nSkipping install + build (--skip-build)');
        }

        // Step 4: agent
        if (!opts.skipAgent) {
          const agentOk = await setupAgent();
          results.push({ name: 'coding agent', passed: agentOk, required: true });
        } else {
          info('\nSkipping agent check (--skip-agent)');
          results.push({ name: 'coding agent', passed: true, required: false });
        }

        // Step 5: credentials
        if (!opts.skipCredentials) {
          const credsOk = await setupContentfulCredentials();
          results.push({ name: 'Contentful credentials', passed: credsOk, required: false });
        } else {
          info('\nSkipping credentials (--skip-credentials)');
        }

        // Step 6: optional QoL
        if (!opts.skipOptional) {
          await setupQoL(profilePath);
        }

        // ── Summary ────────────────────────────────────────────────────────────
        section('Summary');

        const requiredFailed = results.filter((r) => r.required && !r.passed);
        const optionalFailed = results.filter((r) => !r.required && !r.passed);

        for (const r of results) {
          if (r.passed) {
            ok(`${r.name}`);
          } else if (r.required) {
            fail(`${r.name} — required`);
          } else {
            warn(`${r.name} — optional`);
          }
        }

        process.stdout.write('\n');

        if (requiredFailed.length === 0) {
          process.stdout.write('\x1b[32m\x1b[1m✓ Setup complete. You can now run: experiences import\x1b[0m\n');
          if (optionalFailed.length > 0) {
            process.stdout.write("  (Some optional steps were skipped — that's fine.)\n");
          }
        } else {
          process.stdout.write(
            `\x1b[33m\x1b[1m⚠ ${requiredFailed.length} required step${requiredFailed.length === 1 ? '' : 's'} incomplete.\x1b[0m\n`,
          );
          process.stdout.write('  Complete the steps above, then re-run \x1b[1mexperiences setup\x1b[0m.\n');
        }

        // ── Offer experiences doctor ───────────────────────────────────────────────────
        process.stdout.write('\n');
        const runDoctor =
          process.stdout.isTTY &&
          (await confirm('Run experiences doctor now to verify your environment?', requiredFailed.length === 0));
        if (runDoctor) {
          process.stdout.write('\n');
          const cliBin = process.argv[1] ?? fileURLToPath(import.meta.url);
          const doctorResult = await runSpawn(process.execPath, [cliBin, 'doctor'], {
            env: process.env,
          });
          process.stdout.write(doctorResult.stdout);
          process.stderr.write(doctorResult.stderr);
          process.exit(doctorResult.exitCode);
        }

        process.stdout.write('\nRun \x1b[1mexperiences doctor\x1b[0m at any time to re-check your environment.\n\n');
        process.exit(requiredFailed.length === 0 ? 0 : 1);
      },
    );
}
