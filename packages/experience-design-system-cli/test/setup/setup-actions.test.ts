import { describe, expect, it, vi } from 'vitest';
import type { ExperiencesCredentials } from '../../src/credentials-store.js';
import {
  runAgentSetup,
  runCredentialsSetup,
  runPreferenceSetupAction,
  runPrerequisitesSetup,
  type SetupActionDependencies,
  type SetupActionEvent,
} from '../../src/setup/setup-actions.js';

function createDependencies(overrides: Partial<SetupActionDependencies> = {}): SetupActionDependencies {
  let credentials: ExperiencesCredentials = { spaceId: '', environmentId: '', cmaToken: '' };
  return {
    nodeVersion: '24.18.1',
    homeDir: '/home/tester',
    env: {},
    ask: async () => '',
    askSecret: async () => '',
    confirm: async () => true,
    choose: async () => 0,
    write: () => undefined,
    binaryExists: async (binary) => binary === 'pnpm',
    run: async () => ({ exitCode: 0, stdout: '10.0.0\n', stderr: '' }),
    pathExists: async () => false,
    profileContains: async () => false,
    appendToProfile: async () => undefined,
    readCredentials: async () => credentials,
    writeCredentials: async (next) => {
      credentials = next;
    },
    credentialsPath: () => '/home/tester/.config/experiences/credentials.json',
    ...overrides,
  };
}

describe('setup actions', () => {
  it('marks a successful fnm install as restart-required and reports failed activation recovery', async () => {
    const events: SetupActionEvent[] = [];
    const run = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: '' });
    const dependencies = createDependencies({
      nodeVersion: '22.0.0',
      binaryExists: async (binary) => binary === 'fnm',
      run,
      write: (event) => events.push(event),
    });

    await expect(runPrerequisitesSetup(dependencies, '/repo')).resolves.toEqual({
      node: { passed: false, restartRequired: true },
    });
    expect(events).toContainEqual({
      kind: 'warning',
      message: 'fnm use 24 failed — node installed but not activated',
    });
    expect(events).toContainEqual({
      kind: 'info',
      message: 'Run manually: fnm use 24 && fnm default 24',
    });
  });

  it('skips install and build when skipBuild is set after prerequisite checks', async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 0, stdout: '10.0.0\n', stderr: '' });
    const dependencies = createDependencies({ run });

    await expect(runPrerequisitesSetup(dependencies, '/repo', { skipBuild: true })).resolves.toEqual({
      node: { passed: true },
      pnpm: { passed: true },
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('pnpm', ['--version']);
  });

  it('returns typed prerequisite results after installing dependencies and building the CLI', async () => {
    const events: SetupActionEvent[] = [];
    const dependencies = createDependencies({ write: (event) => events.push(event) });

    await expect(runPrerequisitesSetup(dependencies, '/repo')).resolves.toEqual({
      node: { passed: true },
      pnpm: { passed: true },
      build: { passed: true },
    });
    expect(events).toContainEqual({ kind: 'success', message: 'CLI built successfully' });
  });

  it('selects an agent by the chosen index when several are installed', async () => {
    const choose = vi.fn().mockResolvedValue(1);
    const dependencies = createDependencies({
      binaryExists: async (binary) => binary === 'claude' || binary === 'codex',
      choose,
      ask: async () => '',
    });

    await expect(runAgentSetup(dependencies)).resolves.toEqual({
      agent: 'codex',
      agentModel: undefined,
      passed: true,
    });
    expect(choose).toHaveBeenCalledWith('Multiple coding agents found. Choose one to use as the default:', [
      { label: 'Claude Code', description: 'claude' },
      { label: 'OpenAI Codex', description: 'codex' },
    ]);
  });

  it('skips the agent step when the chooser resolves undefined', async () => {
    const dependencies = createDependencies({
      binaryExists: async (binary) => binary === 'claude' || binary === 'codex',
      choose: async () => undefined,
    });

    await expect(runAgentSetup(dependencies)).resolves.toEqual({
      agent: undefined,
      agentModel: undefined,
      passed: false,
    });
  });

  it('separates the agent intro from the list that follows it', async () => {
    const events: SetupActionEvent[] = [];
    const dependencies = createDependencies({
      binaryExists: async (binary) => binary === 'claude',
      write: (event) => events.push(event),
    });

    await runAgentSetup(dependencies);

    expect(events.slice(0, 3)).toEqual([
      { kind: 'info', message: 'experiences import uses a coding agent to generate component definitions.' },
      { kind: 'info', message: '' },
      { kind: 'success', message: 'Claude Code (claude) found' },
    ]);
  });

  it('returns the selected Codex agent and typed model from injected prompts', async () => {
    const ask = vi.fn().mockResolvedValue('gpt-next');
    const dependencies = createDependencies({
      ask,
      binaryExists: async (binary) => binary === 'codex',
    });

    await expect(runAgentSetup(dependencies)).resolves.toEqual({
      agent: 'codex',
      agentModel: 'gpt-next',
      passed: true,
    });
    expect(ask).toHaveBeenCalledWith('Model name (optional - press Enter for Codex default): ');
  });

  it('renders stored credential values as a plain readout, not as passed checks', async () => {
    const events: SetupActionEvent[] = [];
    const dependencies = createDependencies({
      readCredentials: async () => ({ spaceId: 'space', environmentId: 'master', cmaToken: 'token-value' }),
      confirm: async () => false,
      write: (event) => events.push(event),
    });

    await runCredentialsSetup(dependencies);

    expect(events).toContainEqual({ kind: 'value', message: 'Space ID        space' });
    expect(events).toContainEqual({ kind: 'value', message: 'Environment ID  master' });
    expect(events).toContainEqual({ kind: 'value', message: 'CMA Token       ••••••••...' });
    expect(events).toContainEqual({ kind: 'value', message: 'API Host        api.contentful.com' });
    expect(events.filter((event) => event.kind === 'success')).toEqual([
      { kind: 'success', message: 'Credentials already configured — no changes made' },
    ]);
  });

  it('flags a missing credential as a warning rather than a value', async () => {
    const events: SetupActionEvent[] = [];
    const dependencies = createDependencies({
      readCredentials: async () => ({ spaceId: 'space', environmentId: '', cmaToken: '' }),
      confirm: async () => false,
      write: (event) => events.push(event),
    });

    await runCredentialsSetup(dependencies);

    expect(events).toContainEqual({ kind: 'warning', message: 'Environment ID  (not set)' });
    expect(events).toContainEqual({ kind: 'warning', message: 'CMA Token       (not set)' });
  });

  it('renders the credentials path notice as help text followed by a spacer', async () => {
    const events: SetupActionEvent[] = [];
    const dependencies = createDependencies({ confirm: async () => false, write: (event) => events.push(event) });

    await runCredentialsSetup(dependencies);

    expect(events.slice(0, 2)).toEqual([
      {
        kind: 'help',
        message:
          'Saved to /home/tester/.config/experiences/credentials.json — loaded automatically by experiences import.',
      },
      { kind: 'info', message: '' },
    ]);
  });

  it('persists credentials collected through injected prompts', async () => {
    const writeCredentials = vi.fn();
    const dependencies = createDependencies({
      ask: vi.fn().mockResolvedValueOnce('space').mockResolvedValueOnce('staging').mockResolvedValueOnce(''),
      askSecret: async () => 'token',
      confirm: async () => true,
      writeCredentials,
    });

    await expect(runCredentialsSetup(dependencies)).resolves.toEqual({ passed: true });
    expect(writeCredentials).toHaveBeenCalledWith({
      spaceId: 'space',
      environmentId: 'staging',
      cmaToken: 'token',
    });
  });

  it('runs every preference in display order without asking which to configure', async () => {
    const dependencies = createDependencies({ ask: async () => '', confirm: async () => false });

    await expect(runPreferenceSetupAction(dependencies, '/home/tester/.zshrc')).resolves.toEqual({
      selected: ['autoFilter', 'concurrency', 'customPrompts', 'debug', 'analytics', 'noColor'],
    });
  });

  it('persists a changed preference collected through injected prompts', async () => {
    const writeCredentials = vi.fn();
    const dependencies = createDependencies({
      ask: async (question) => (question.includes('auto-filter') ? 'n' : ''),
      confirm: async () => false,
      writeCredentials,
    });

    await runPreferenceSetupAction(dependencies, '/home/tester/.zshrc');

    expect(writeCredentials).toHaveBeenCalledWith({
      spaceId: '',
      environmentId: '',
      cmaToken: '',
      autoFilter: false,
    });
  });

  it('opens each preference on its own page with help text describing what it does', async () => {
    const events: SetupActionEvent[] = [];
    const dependencies = createDependencies({
      ask: async () => '',
      confirm: async () => false,
      write: (event) => events.push(event),
    });

    await runPreferenceSetupAction(dependencies, '/home/tester/.zshrc');

    const help = events.filter((event) => event.kind === 'page').map((event) => event.message);
    expect(help).toEqual([
      'Filters out components irrelevant to experience orchestration during extraction.',
      'Analyzes more components at once, which is faster on machines with spare cores.',
      'Replaces the built-in instructions the coding agent follows when it selects and generates components.',
      'Writes a verbose trace of every command decision, for troubleshooting.',
      'Shares anonymous usage data about which CLI commands run.',
      'Prints plain text with no color, which suits CI logs and basic terminals.',
    ]);
  });

  it('asks about effects rather than the environment variables behind them', async () => {
    const questions: string[] = [];
    const dependencies = createDependencies({
      ask: async () => '',
      confirm: async (question) => {
        questions.push(question);
        return false;
      },
    });

    await runPreferenceSetupAction(dependencies, '/home/tester/.zshrc');

    expect(questions).toContain('Speed up component analysis on this machine?');
    expect(questions).toContain('Turn off colored output?');
    expect(questions).toContain('Use your own prompt files instead of the built-in ones?');
    expect(questions.join(' ')).not.toContain('NO_COLOR');
    expect(questions.join(' ')).not.toContain('EDS_EXTRACT_CONCURRENCY');
  });
});
