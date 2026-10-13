import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT, parseAgentModel, resolveAgent, resolveModel } from '../../src/import/agent-model-resolve.js';

/**
 * `experiences import --agent <name[:model]>` must override stored credentials
 * and thread the resolved model into spawned subprocesses.
 */

describe('agent/model resolution chain', () => {
  it('parses a colon-delimited agent and model', () => {
    expect(parseAgentModel('codex:gpt-5')).toEqual({ agent: 'codex', model: 'gpt-5' });
  });

  it('parses a whitespace-delimited agent and model', () => {
    expect(parseAgentModel('codex gpt-5')).toEqual({ agent: 'codex', model: 'gpt-5' });
  });

  it('leaves the model unset when only an agent is provided', () => {
    expect(parseAgentModel('codex')).toEqual({ agent: 'codex' });
  });

  it('flag wins over stored value (--agent)', () => {
    expect(resolveAgent('codex', 'claude')).toBe('codex');
  });

  it('falls back to stored value when no flag is given (--agent)', () => {
    expect(resolveAgent(undefined, 'codex')).toBe('codex');
  });

  it('falls back to the built-in default when neither flag nor stored value is set', () => {
    expect(resolveAgent(undefined, undefined)).toBe(DEFAULT_AGENT);
    expect(DEFAULT_AGENT).toBe('claude');
  });

  it('treats an empty-string flag as "not provided" (--agent)', () => {
    expect(resolveAgent('', 'codex')).toBe('codex');
  });

  it('flag wins over stored value (--model)', () => {
    expect(resolveModel('gpt-5', 'claude-opus-4-5')).toBe('gpt-5');
  });

  it('falls back to stored value when no flag is given (--model)', () => {
    expect(resolveModel(undefined, 'claude-opus-4-5')).toBe('claude-opus-4-5');
  });

  it('returns undefined when neither flag nor stored model is set', () => {
    expect(resolveModel(undefined, undefined)).toBeUndefined();
  });
});
