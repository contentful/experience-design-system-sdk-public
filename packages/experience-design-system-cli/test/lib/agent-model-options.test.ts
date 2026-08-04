import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { addAgentModelOptions, AGENT_DESCRIPTION, MODEL_DESCRIPTION } from '../../src/lib/agent-model-options.js';

function findOption(cmd: Command, long: string) {
  return cmd.options.find((o) => o.long === long);
}

describe('addAgentModelOptions', () => {
  it('registers --agent and --model with the default descriptions', () => {
    const cmd = new Command();
    addAgentModelOptions(cmd);
    expect(findOption(cmd, '--agent')?.description).toBe(AGENT_DESCRIPTION);
    expect(findOption(cmd, '--model')?.description).toBe(MODEL_DESCRIPTION);
  });

  it('omits --model when includeModel is false', () => {
    const cmd = new Command();
    addAgentModelOptions(cmd, { includeModel: false });
    expect(findOption(cmd, '--agent')).toBeDefined();
    expect(findOption(cmd, '--model')).toBeUndefined();
  });

  it('applies agentDescription and modelDescription overrides', () => {
    const cmd = new Command();
    addAgentModelOptions(cmd, {
      agentDescription: 'custom agent help',
      modelDescription: 'custom model help',
    });
    expect(findOption(cmd, '--agent')?.description).toBe('custom agent help');
    expect(findOption(cmd, '--model')?.description).toBe('custom model help');
  });

  it('returns the same Command instance for chaining', () => {
    const cmd = new Command();
    expect(addAgentModelOptions(cmd)).toBe(cmd);
  });
});
