import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';
import {
  CodingAgentScreen,
  detectAgents,
  needsCodexModel,
  type CodingAgentDeps,
} from '../../../src/setup/steps/CodingAgentScreen.js';
import type { StepStatus } from '../../../src/setup/steps/StepLayout.js';
import { waitForFrame } from '../../helpers/wait-for-frame.js';

const DOWN = String.fromCharCode(27) + '[B';

const store = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));

vi.mock('../../../src/credentials-store.js', () => ({
  readExperiencesCredentials: store.read,
  writeExperiencesCredentials: store.write,
  experiencesCredentialsPath: () => '/home/tester/.config/experiences/credentials.json',
}));

function makeDeps(overrides: Partial<CodingAgentDeps> = {}): CodingAgentDeps {
  return {
    binaryExists: async () => false,
    run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    env: {},
    ...overrides,
  };
}

function setup(
  deps: CodingAgentDeps,
  stored: Record<string, unknown> = { spaceId: '', environmentId: '', cmaToken: '' },
) {
  store.read.mockReset().mockResolvedValue(stored);
  store.write.mockReset().mockResolvedValue(undefined);
  const onDone = vi.fn<(status: StepStatus) => void>();
  return { ...render(<CodingAgentScreen onDone={onDone} deps={deps} />), onDone, write: store.write };
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100));

describe('detectAgents', () => {
  it('returns only the agents present on PATH, in definition order', async () => {
    const found = await detectAgents(async (binary) => binary === 'codex' || binary === 'claude');
    expect(found.map((agent) => agent.binary)).toEqual(['claude', 'codex']);
  });

  it('returns nothing when no agent is installed', async () => {
    expect(await detectAgents(async () => false)).toEqual([]);
  });
});

describe('needsCodexModel', () => {
  it('asks for a model only for codex without an API key', () => {
    expect(needsCodexModel('codex', {})).toBe(true);
    expect(needsCodexModel('codex', { OPENAI_API_KEY: 'sk-x' })).toBe(false);
    expect(needsCodexModel('claude', {})).toBe(false);
  });
});

describe('CodingAgentScreen', () => {
  it('saves the only installed agent without asking', async () => {
    const { onDone, write } = setup(makeDeps({ binaryExists: async (b) => b === 'claude' }));
    await settle();

    expect(write).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude' }));
    expect(onDone).toHaveBeenCalledWith('completed');
  });

  it('offers a choice when several agents are installed', async () => {
    const { lastFrame } = setup(makeDeps({ binaryExists: async (b) => b === 'claude' || b === 'codex' }));

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Multiple coding agents found'),
    );

    expect(frame).toContain('Claude Code');
    expect(frame).toContain('OpenAI Codex');
    expect(frame).toContain('Skip');
  });

  it('saves the agent the operator highlights', async () => {
    const { lastFrame, stdin, write } = setup(
      makeDeps({ binaryExists: async (b) => b === 'claude' || b === 'opencode', env: {} }),
    );

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Multiple coding agents found'),
    );
    stdin.write(DOWN);
    await settle();
    stdin.write(String.fromCharCode(13));
    await settle();

    expect(write).toHaveBeenCalledWith(expect.objectContaining({ agent: 'opencode' }));
  });

  it('asks codex for a model when no API key is set', async () => {
    const { lastFrame, stdin, write } = setup(makeDeps({ binaryExists: async (b) => b === 'codex', env: {} }));

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Model name'),
    );
    stdin.write('gpt-next');
    await settle();
    stdin.write(String.fromCharCode(13));
    await settle();

    expect(write).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', agentModel: 'gpt-next' }));
  });

  it('skips the model question when OPENAI_API_KEY is set', async () => {
    const { write } = setup(makeDeps({ binaryExists: async (b) => b === 'codex', env: { OPENAI_API_KEY: 'sk-x' } }));
    await settle();

    const saved = write.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved['agent']).toBe('codex');
    expect(saved).not.toHaveProperty('agentModel');
  });

  it('replaces a stale model when the agent is reconfigured', async () => {
    const { write } = setup(makeDeps({ binaryExists: async (b) => b === 'claude' }), {
      spaceId: '',
      environmentId: '',
      cmaToken: '',
      agent: 'codex',
      agentModel: 'gpt-old',
    });
    await settle();

    const saved = write.mock.calls[0]![0] as Record<string, unknown>;
    expect(saved['agent']).toBe('claude');
    expect(saved).not.toHaveProperty('agentModel');
  });

  it('offers an install list when nothing is on PATH', async () => {
    const { lastFrame } = setup(makeDeps());

    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Choose one to install'),
    );

    expect(frame).toContain('No coding agent found on PATH');
    expect(frame).toContain('npm install -g @anthropic-ai/claude-code');
  });

  it('reports failure when the install command fails', async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'boom' });
    const { lastFrame, stdin, onDone } = setup(makeDeps({ run }));

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Choose one to install'),
    );
    stdin.write(String.fromCharCode(13));
    await settle();

    expect(run).toHaveBeenCalledWith('npm', ['install', '-g', '@anthropic-ai/claude-code']);
    expect(onDone).toHaveBeenCalledWith('failed');
  });

  it('reports failure when the binary is still missing after a clean install', async () => {
    const { lastFrame, stdin, onDone } = setup(
      makeDeps({ run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) }),
    );

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Choose one to install'),
    );
    stdin.write(String.fromCharCode(13));
    await settle();

    expect(onDone).toHaveBeenCalledWith('failed');
  });

  // The model question follows a Select. Rendering it as page content rather
  // than as the prompt left that Select mounted, so it kept consuming keys and
  // the model input swallowed the Enter meant to submit it.
  it('asks for the codex model after a choice without the chooser eating keys', async () => {
    const { lastFrame, stdin, write } = setup(
      makeDeps({ binaryExists: async (b) => b === 'claude' || b === 'codex', env: {} }),
    );

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Multiple coding agents found'),
    );
    stdin.write(DOWN);
    await settle();
    stdin.write(String.fromCharCode(13));

    await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Model name'),
    );
    stdin.write('gpt-after-select');
    await settle();
    stdin.write(String.fromCharCode(13));
    await settle();

    expect(write).toHaveBeenCalledWith(expect.objectContaining({ agent: 'codex', agentModel: 'gpt-after-select' }));
  });

  it('leads with what the agent is for', async () => {
    const { lastFrame } = setup(makeDeps());
    const frame = await waitForFrame(
      () => lastFrame(),
      (f) => f.includes('Experiences import requires a coding agent'),
    );
    expect(frame).toContain('Experiences import requires a coding agent to generate component definitions.');
  });
});
