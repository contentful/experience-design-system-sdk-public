import { describe, expect, it } from 'vitest';
import { AGENT_NAMES, DEFAULT_AGENT_NAME, isAgentName } from '../../src/generate/model/agent.js';

describe('agent definitions', () => {
  it('exposes the canonical agent names and validates against them', () => {
    expect(AGENT_NAMES).toEqual(['claude', 'codex', 'opencode', 'cursor', 'copilot']);
    expect(DEFAULT_AGENT_NAME).toBe('claude');
    expect(AGENT_NAMES.every(isAgentName)).toBe(true);
    expect(isAgentName('other')).toBe(false);
  });
});
