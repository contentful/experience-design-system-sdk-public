import { join } from 'node:path';
import type { AgentName } from '@contentful/experience-design-system-generation';
import type { ExperiencesCredentials } from '../credentials-store.js';
import { DEFAULT_CONFIGURED_HOST, toConfiguredHost } from '../host-utils.js';
import { promptAnalyticsPreference } from './analytics-prompt.js';
import { promptAutoFilterPreference } from './auto-filter-prompt.js';
import { promptDebugModePreference } from './debug-mode-prompt.js';
import { PREFERENCE_OPTIONS, type PreferenceKey } from './preferences-picker.js';

const REQUIRED_NODE_MAJOR = 24;

export type SetupActionEventKind = 'success' | 'failure' | 'warning' | 'info' | 'dim' | 'choice' | 'value';

export interface SetupActionEvent {
  kind: SetupActionEventKind;
  message: string;
}

export interface SetupCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SetupActionDependencies {
  nodeVersion: string;
  homeDir: string;
  env: NodeJS.ProcessEnv;
  ask(question: string): Promise<string>;
  askSecret(question: string): Promise<string>;
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
  /** Resolves the chosen index, or `undefined` when the operator skips. */
  choose(question: string, options: readonly SetupChoice[]): Promise<number | undefined>;
  /** Resolves the chosen indexes, empty when the operator selects nothing. */
  chooseMany(question: string, options: readonly SetupChoice[]): Promise<number[]>;
  write(event: SetupActionEvent): void;
  binaryExists(binary: string): Promise<boolean>;
  run(
    command: string,
    args: string[],
    options?: { cwd?: string; env?: NodeJS.ProcessEnv },
  ): Promise<SetupCommandResult>;
  pathExists(path: string): Promise<boolean>;
  profileContains(profilePath: string, value: string): Promise<boolean>;
  appendToProfile(profilePath: string, lines: string): Promise<void>;
  readCredentials(): Promise<ExperiencesCredentials>;
  writeCredentials(credentials: ExperiencesCredentials): Promise<void>;
  credentialsPath(): string;
}

export interface SetupChoice {
  label: string;
  description?: string;
}

export interface SetupCheckResult {
  passed: boolean;
}

export interface PrerequisitesSetupResult {
  node: SetupCheckResult & { restartRequired?: boolean };
  pnpm?: SetupCheckResult;
  build?: SetupCheckResult;
}

export interface AgentSetupResult {
  agent: AgentName | undefined;
  agentModel: string | undefined;
  passed: boolean;
}

const AGENT_DEFS: Array<{ name: string; binary: AgentName; installHint: string }> = [
  { name: 'Claude Code', binary: 'claude', installHint: 'npm install -g @anthropic-ai/claude-code && claude login' },
  { name: 'OpenAI Codex', binary: 'codex', installHint: 'npm install -g @openai/codex  (requires OPENAI_API_KEY)' },
  { name: 'OpenCode', binary: 'opencode', installHint: 'npm install -g opencode-ai && opencode auth' },
  { name: 'GitHub Copilot', binary: 'copilot', installHint: 'npm install -g @github/copilot && copilot' },
];

function emit(dependencies: SetupActionDependencies, kind: SetupActionEventKind, message: string): void {
  dependencies.write({ kind, message });
}

export async function runPrerequisitesSetup(
  dependencies: SetupActionDependencies,
  repoRoot: string,
  options: { skipBuild?: boolean } = {},
): Promise<PrerequisitesSetupResult> {
  const node = await runNodeSetup(dependencies);
  if (!node.passed) return { node };

  const pnpm = await runPnpmSetup(dependencies);
  if (!pnpm.passed || options.skipBuild) return { node, pnpm };

  const build = await runBuildSetup(dependencies, repoRoot);
  return { node, pnpm, build };
}

export async function runNodeSetup(
  dependencies: SetupActionDependencies,
): Promise<SetupCheckResult & { restartRequired?: boolean }> {
  const major = Number.parseInt(dependencies.nodeVersion.split('.')[0]!, 10);
  if (major >= REQUIRED_NODE_MAJOR) {
    emit(dependencies, 'success', `Node.js v${dependencies.nodeVersion} — already good`);
    return { passed: true };
  }

  emit(dependencies, 'failure', `Node.js v${dependencies.nodeVersion} — need v${REQUIRED_NODE_MAJOR}+`);
  const nvmScript = join(dependencies.homeDir, '.nvm', 'nvm.sh');
  const hasNvm = (await dependencies.binaryExists('nvm')) || (await dependencies.pathExists(nvmScript));
  const hasFnm = await dependencies.binaryExists('fnm');

  if (hasNvm) {
    emit(
      dependencies,
      'info',
      `nvm detected. Will run: nvm install ${REQUIRED_NODE_MAJOR} && nvm use ${REQUIRED_NODE_MAJOR}`,
    );
    if (!(await dependencies.confirm(`Install and switch to Node ${REQUIRED_NODE_MAJOR} via nvm?`))) {
      emit(
        dependencies,
        'warning',
        `Skipped. Re-run experiences setup after switching to Node ${REQUIRED_NODE_MAJOR}.`,
      );
      return { passed: false };
    }
    const result = await dependencies.run('bash', [
      '-c',
      `source "${nvmScript}" && nvm install ${REQUIRED_NODE_MAJOR} && nvm alias default ${REQUIRED_NODE_MAJOR}`,
    ]);
    if (result.exitCode !== 0) {
      emit(dependencies, 'failure', 'nvm install failed');
      emit(dependencies, 'info', `Run manually: nvm install ${REQUIRED_NODE_MAJOR} && nvm use ${REQUIRED_NODE_MAJOR}`);
      return { passed: false };
    }
    emit(
      dependencies,
      'success',
      `Node ${REQUIRED_NODE_MAJOR} installed via nvm. Re-run experiences setup in a fresh shell to pick it up.`,
    );
    return { passed: false, restartRequired: true };
  }

  if (hasFnm) {
    emit(
      dependencies,
      'info',
      `fnm detected. Will run: fnm install ${REQUIRED_NODE_MAJOR} && fnm use ${REQUIRED_NODE_MAJOR}`,
    );
    if (!(await dependencies.confirm(`Install and switch to Node ${REQUIRED_NODE_MAJOR} via fnm?`))) {
      emit(
        dependencies,
        'warning',
        `Skipped. Re-run experiences setup after switching to Node ${REQUIRED_NODE_MAJOR}.`,
      );
      return { passed: false };
    }
    const install = await dependencies.run('fnm', ['install', String(REQUIRED_NODE_MAJOR)]);
    if (install.exitCode !== 0) {
      emit(dependencies, 'failure', 'fnm install failed');
      return { passed: false };
    }
    const useResult = await dependencies.run('fnm', ['use', String(REQUIRED_NODE_MAJOR)]);
    if (useResult.exitCode !== 0) {
      emit(dependencies, 'warning', `fnm use ${REQUIRED_NODE_MAJOR} failed — node installed but not activated`);
      emit(dependencies, 'info', `Run manually: fnm use ${REQUIRED_NODE_MAJOR} && fnm default ${REQUIRED_NODE_MAJOR}`);
    } else {
      const defaultResult = await dependencies.run('fnm', ['default', String(REQUIRED_NODE_MAJOR)]);
      if (defaultResult.exitCode !== 0) {
        emit(
          dependencies,
          'warning',
          `fnm default ${REQUIRED_NODE_MAJOR} failed — version won't persist across new shells`,
        );
        emit(dependencies, 'info', `Run manually: fnm default ${REQUIRED_NODE_MAJOR}`);
      }
    }
    emit(
      dependencies,
      'success',
      `Node ${REQUIRED_NODE_MAJOR} installed via fnm. Re-run experiences setup in a fresh shell.`,
    );
    return { passed: false, restartRequired: true };
  }

  emit(dependencies, 'info', 'No Node version manager detected (nvm or fnm).');
  if (!(await dependencies.confirm('Install nvm now? (recommended)'))) {
    emit(dependencies, 'info', `Install Node ${REQUIRED_NODE_MAJOR} manually from https://nodejs.org`);
    return { passed: false };
  }
  const result = await dependencies.run('bash', [
    '-c',
    'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash',
  ]);
  if (result.exitCode !== 0) {
    emit(dependencies, 'failure', 'nvm install failed');
    return { passed: false };
  }
  emit(dependencies, 'success', 'nvm installed. Open a new shell, then re-run experiences setup.');
  return { passed: false, restartRequired: true };
}

export async function runPnpmSetup(dependencies: SetupActionDependencies): Promise<SetupCheckResult> {
  if (await dependencies.binaryExists('pnpm')) {
    const version = await dependencies.run('pnpm', ['--version']);
    emit(dependencies, 'success', `pnpm v${version.stdout.trim()} — already installed`);
    return { passed: true };
  }

  emit(dependencies, 'failure', 'pnpm not found');
  if (await dependencies.binaryExists('corepack')) {
    emit(dependencies, 'info', 'Will run: corepack enable && corepack prepare pnpm@latest --activate');
    if (await dependencies.confirm('Install pnpm via corepack?')) {
      const enabled = await dependencies.run('corepack', ['enable']);
      const installed =
        enabled.exitCode === 0 ? await dependencies.run('corepack', ['prepare', 'pnpm@latest', '--activate']) : enabled;
      if (installed.exitCode === 0) {
        emit(dependencies, 'success', 'pnpm installed via corepack');
        return { passed: true };
      }
      emit(dependencies, 'failure', 'corepack install failed');
      return { passed: false };
    }
  }

  emit(dependencies, 'info', 'Will run: npm install -g pnpm');
  if (!(await dependencies.confirm('Install pnpm via npm?'))) {
    emit(dependencies, 'warning', 'Skipped. Install pnpm manually: npm install -g pnpm');
    return { passed: false };
  }
  const result = await dependencies.run('npm', ['install', '-g', 'pnpm']);
  if (result.exitCode !== 0) {
    emit(dependencies, 'failure', 'npm install -g pnpm failed');
    return { passed: false };
  }
  emit(dependencies, 'success', 'pnpm installed');
  return { passed: true };
}

export async function runBuildSetup(
  dependencies: SetupActionDependencies,
  repoRoot: string,
): Promise<SetupCheckResult> {
  emit(dependencies, 'info', 'Running pnpm install...');
  const install = await dependencies.run('pnpm', ['install', '--frozen-lockfile'], { cwd: repoRoot });
  if (install.exitCode !== 0) {
    emit(dependencies, 'failure', 'pnpm install failed');
    return { passed: false };
  }
  emit(dependencies, 'success', 'Dependencies installed');
  emit(dependencies, 'info', 'Building CLI...');
  const build = await dependencies.run(
    'pnpm',
    ['--filter', '@contentful/experience-design-system-cli', 'run', 'build'],
    { cwd: repoRoot },
  );
  if (build.exitCode !== 0) {
    emit(dependencies, 'failure', 'Build failed');
    return { passed: false };
  }
  emit(dependencies, 'success', 'CLI built successfully');
  return { passed: true };
}

async function promptCodexModel(dependencies: SetupActionDependencies): Promise<string | undefined> {
  if (dependencies.env['OPENAI_API_KEY']) return undefined;
  emit(dependencies, 'warning', 'No OPENAI_API_KEY — using ChatGPT account authentication.');
  emit(dependencies, 'info', 'Tip: run codex then type /model to browse all available models.');
  const model = (await dependencies.ask('Model name (optional - press Enter for Codex default): ')).trim();
  return model || undefined;
}

export async function runAgentSetup(dependencies: SetupActionDependencies): Promise<AgentSetupResult> {
  emit(dependencies, 'info', 'experiences import uses a coding agent to generate component definitions.');
  emit(dependencies, 'info', '');
  const found = (
    await Promise.all(
      AGENT_DEFS.map(async (agent) => ((await dependencies.binaryExists(agent.binary)) ? agent : undefined)),
    )
  ).filter((agent): agent is (typeof AGENT_DEFS)[number] => agent !== undefined);
  if (found.length === 1) {
    const selected = found[0]!;
    emit(dependencies, 'success', `${selected.name} (${selected.binary}) found`);
    const agentModel = selected.binary === 'codex' ? await promptCodexModel(dependencies) : undefined;
    return { agent: selected.binary, agentModel, passed: true };
  }
  if (found.length > 1) {
    const index = await dependencies.choose(
      'Multiple coding agents found. Choose one to use as the default:',
      found.map((agent) => ({ label: agent.name, description: agent.binary })),
    );
    if (index === undefined) return { agent: undefined, agentModel: undefined, passed: false };
    const selected = found[index] ?? found[0]!;
    const agentModel = selected.binary === 'codex' ? await promptCodexModel(dependencies) : undefined;
    return { agent: selected.binary, agentModel, passed: true };
  }

  emit(dependencies, 'warning', 'No coding agent found on PATH');
  const installable = AGENT_DEFS.slice(0, 3);
  const index = await dependencies.choose(
    'Choose one to install:',
    installable.map((agent) => ({ label: agent.name, description: agent.installHint })),
  );
  const selected = index === undefined ? undefined : installable[index];
  if (!selected) return { agent: undefined, agentModel: undefined, passed: false };
  const packageName =
    selected.binary === 'claude'
      ? '@anthropic-ai/claude-code'
      : selected.binary === 'codex'
        ? '@openai/codex'
        : 'opencode-ai';
  const installed = await dependencies.run('npm', ['install', '-g', packageName]);
  if (installed.exitCode !== 0 || !(await dependencies.binaryExists(selected.binary))) {
    emit(dependencies, 'failure', 'Install failed');
    return { agent: undefined, agentModel: undefined, passed: false };
  }
  emit(dependencies, 'success', `${selected.name} installed`);
  const agentModel = selected.binary === 'codex' ? await promptCodexModel(dependencies) : undefined;
  return { agent: selected.binary, agentModel, passed: true };
}

const CURRENT_VALUE_LABEL_WIDTH = 'Environment ID'.length + 2;

function emitCurrentValue(
  dependencies: SetupActionDependencies,
  label: string,
  value: string | undefined | false,
): void {
  const paddedLabel = label.padEnd(CURRENT_VALUE_LABEL_WIDTH);
  if (value) emit(dependencies, 'value', `${paddedLabel}${value}`);
  else emit(dependencies, 'warning', `${paddedLabel}(not set)`);
}

export async function runCredentialsSetup(dependencies: SetupActionDependencies): Promise<SetupCheckResult> {
  emit(
    dependencies,
    'info',
    `Saved to ${dependencies.credentialsPath()} — loaded automatically by experiences import.`,
  );
  emit(dependencies, 'info', '');
  const envShadowing = [
    dependencies.env['CONTENTFUL_SPACE_ID'] ? 'CONTENTFUL_SPACE_ID' : undefined,
    dependencies.env['CONTENTFUL_ENVIRONMENT_ID'] ? 'CONTENTFUL_ENVIRONMENT_ID' : undefined,
    dependencies.env['CONTENTFUL_MANAGEMENT_TOKEN'] ? 'CONTENTFUL_MANAGEMENT_TOKEN' : undefined,
    dependencies.env['EDS_HOST'] ? 'EDS_HOST' : undefined,
  ].filter((value): value is string => value !== undefined);
  if (envShadowing.length > 0) {
    emit(
      dependencies,
      'warning',
      `Env vars set: ${envShadowing.join(', ')}. Values saved here take precedence; env vars only apply where disk is empty.`,
    );
  }

  const stored = await dependencies.readCredentials();
  const currentHost = stored.host ?? DEFAULT_CONFIGURED_HOST;
  const hasAny = Boolean(stored.spaceId || stored.environmentId || stored.cmaToken);
  const allSet = Boolean(stored.spaceId && stored.environmentId && stored.cmaToken);
  if (hasAny) {
    emit(dependencies, 'info', 'Current values:');
    emitCurrentValue(dependencies, 'Space ID', stored.spaceId);
    emitCurrentValue(dependencies, 'Environment ID', stored.environmentId);
    emitCurrentValue(
      dependencies,
      'CMA Token',
      stored.cmaToken && `${'•'.repeat(Math.min(stored.cmaToken.length, 8))}...`,
    );
    emitCurrentValue(dependencies, 'API Host', currentHost);
  }
  if (!(await dependencies.confirm(hasAny ? 'Update credentials?' : 'Configure Contentful credentials?', !allSet))) {
    if (allSet) emit(dependencies, 'success', 'Credentials already configured — no changes made');
    else emit(dependencies, 'warning', 'Skipped. experiences import will prompt for credentials interactively.');
    return { passed: true };
  }
  const spaceId =
    (await dependencies.ask(`Space ID${stored.spaceId ? ` [${stored.spaceId}]` : ''}: `)) || stored.spaceId;
  const environmentId =
    (await dependencies.ask(`Environment ID [${stored.environmentId || 'master'}]: `)) ||
    stored.environmentId ||
    'master';
  const cmaToken =
    (await dependencies.askSecret(
      `CMA token${stored.cmaToken ? ' [press Enter to keep existing]' : ' (paste here)'}: `,
    )) || stored.cmaToken;
  if (!spaceId || !cmaToken) {
    emit(dependencies, 'warning', 'Space ID and CMA token are required. Skipped.');
    return { passed: false };
  }
  const hostInput = await dependencies.ask(`API host [${currentHost}]: `);
  const host = toConfiguredHost(hostInput) ?? stored.host;
  await dependencies.writeCredentials({ ...stored, spaceId, environmentId, cmaToken, ...(host ? { host } : {}) });
  emit(dependencies, 'success', `Credentials saved to ${dependencies.credentialsPath()}`);
  emit(dependencies, 'success', `API host set to ${host ?? DEFAULT_CONFIGURED_HOST}`);
  emit(dependencies, 'info', 'Run experiences import — credentials will be pre-filled automatically.');
  return { passed: true };
}

export async function promptCustomSkillPathAction(
  kind: 'select' | 'generate',
  current: string | undefined,
  ask: SetupActionDependencies['ask'],
): Promise<string | undefined | null> {
  const label = kind === 'select' ? 'select (analyze select-agent)' : 'generate (generate components)';
  const answer = await ask(
    `Custom ${label} prompt path${current ? ` [${current}]` : ' [none]'} (empty=keep, "-"=clear): `,
  );
  const trimmed = answer.trim();
  return trimmed === '' ? undefined : trimmed === '-' ? null : trimmed;
}

export async function runPreferenceSetupAction(
  dependencies: SetupActionDependencies,
  profilePath: string,
): Promise<{ selected: PreferenceKey[] }> {
  const chosen = await dependencies.chooseMany(
    'Choose preferences to configure:',
    PREFERENCE_OPTIONS.map((option) => ({ label: option.label })),
  );
  const selected = chosen.map((index) => PREFERENCE_OPTIONS[index]!.key);
  if (selected.length === 0) {
    emit(dependencies, 'info', 'No preferences changed.');
    return { selected };
  }
  for (const preference of selected) await runPreference(dependencies, profilePath, preference);
  return { selected };
}

async function runPreference(
  dependencies: SetupActionDependencies,
  profilePath: string,
  preference: PreferenceKey,
): Promise<void> {
  if (preference === 'autoFilter') {
    const stored = await dependencies.readCredentials();
    const autoFilter = await promptAutoFilterPreference(dependencies.ask, stored.autoFilter);
    if (autoFilter !== (stored.autoFilter ?? true)) await dependencies.writeCredentials({ ...stored, autoFilter });
    return;
  }
  if (preference === 'concurrency') {
    if (
      !(await dependencies.profileContains(profilePath, 'EDS_EXTRACT_CONCURRENCY')) &&
      (await dependencies.confirm('Add EDS_EXTRACT_CONCURRENCY=8 to your profile?', false))
    ) {
      await dependencies.appendToProfile(profilePath, '# experiences performance\nexport EDS_EXTRACT_CONCURRENCY=8');
    }
    return;
  }
  if (preference === 'customPrompts') {
    if (!(await dependencies.confirm('Configure custom skill prompt paths?', false))) return;
    const stored = await dependencies.readCredentials();
    const selectPromptPath = await promptCustomSkillPathAction('select', stored.selectPromptPath, dependencies.ask);
    const generatePromptPath = await promptCustomSkillPathAction(
      'generate',
      stored.generatePromptPath,
      dependencies.ask,
    );
    const updated = { ...stored };
    if (selectPromptPath === null) delete updated.selectPromptPath;
    else if (selectPromptPath !== undefined) updated.selectPromptPath = selectPromptPath;
    if (generatePromptPath === null) delete updated.generatePromptPath;
    else if (generatePromptPath !== undefined) updated.generatePromptPath = generatePromptPath;
    await dependencies.writeCredentials(updated);
    return;
  }
  if (preference === 'debug') {
    const stored = await dependencies.readCredentials();
    const debug = await promptDebugModePreference(dependencies.ask, stored.debug);
    if (debug !== (stored.debug ?? false)) await dependencies.writeCredentials({ ...stored, debug });
    return;
  }
  if (preference === 'analytics') {
    const stored = await dependencies.readCredentials();
    const analyticsDisabled = await promptAnalyticsPreference(dependencies.ask, stored.analyticsDisabled);
    if (analyticsDisabled !== (stored.analyticsDisabled ?? false))
      await dependencies.writeCredentials({ ...stored, analyticsDisabled });
    return;
  }
  if (await dependencies.confirm('Add NO_COLOR=1 (disable colors) to your profile?', false)) {
    if (!(await dependencies.profileContains(profilePath, 'NO_COLOR')))
      await dependencies.appendToProfile(profilePath, 'export NO_COLOR=1');
  }
}
