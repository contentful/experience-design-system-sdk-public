import { describe, expect, it, vi } from 'vitest';
import { runAgentSetup } from '../../../src/setup/steps/coding-agent.js';
import type { SetupActionEvent } from '../../../src/setup/lib/types.js';
import { createDependencies } from './dependencies.js';

describe('coding agent step', () => {
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

  it('introduces the agent step before reporting what it found', async () => {
    const events: SetupActionEvent[] = [];
    const dependencies = createDependencies({
      binaryExists: async (binary) => binary === 'claude',
      write: (event) => events.push(event),
    });

    await runAgentSetup(dependencies);

    expect(events.slice(0, 2)).toEqual([
      { kind: 'info', message: 'Experiences import uses a coding agent to generate component definitions.' },
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
});
