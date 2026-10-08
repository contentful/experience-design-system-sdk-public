import { describe, expect, it } from 'vitest';
import { parseAgentModel } from '../helpers/resolution/parse-agent-model.js';

describe('parseAgentModel', () => {
  it('returns {} for empty / whitespace input', () => {
    expect(parseAgentModel(undefined)).toEqual({});
    expect(parseAgentModel('')).toEqual({});
    expect(parseAgentModel('   ')).toEqual({});
  });
  it('parses "agent:model" form', () => {
    expect(parseAgentModel('claude:sonnet-4')).toEqual({ agent: 'claude', model: 'sonnet-4' });
  });
  it('parses "agent model" form', () => {
    expect(parseAgentModel('claude sonnet 4')).toEqual({ agent: 'claude', model: 'sonnet 4' });
  });
  it('returns just the agent when no model is given', () => {
    expect(parseAgentModel('claude')).toEqual({ agent: 'claude' });
  });
  it('leaves agent undefined when the colon is empty-prefixed', () => {
    expect(parseAgentModel(':model')).toEqual({ agent: undefined, model: 'model' });
  });
});
