import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT,
  resolveAgent,
  resolveModel,
} from '../../src/import/agent-model-resolve.js';
import {
  buildGenerateComponentsArgs,
  buildSelectAgentArgs,
} from '../../src/import/tui/WizardApp.js';

/**
 * Parity-audit Q4: `experiences import --agent <name>` and `--model <name>`
 * must actually override the stored `credentials.json` value for the wizard
 * path, and the wizard must thread the resolved model into the spawned
 * subprocesses.
 */

describe('agent/model resolution chain', () => {
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

describe('wizard subprocess arg builders thread --model through', () => {
  it('buildSelectAgentArgs appends --model when provided', () => {
    const args = buildSelectAgentArgs({
      sessionId: 's1',
      agent: 'codex',
      model: 'gpt-5',
    });
    expect(args).toContain('--model');
    const idx = args.indexOf('--model');
    expect(args[idx + 1]).toBe('gpt-5');
    expect(args).toContain('--agent');
    expect(args).toContain('codex');
  });

  it('buildSelectAgentArgs omits --model when not provided', () => {
    const args = buildSelectAgentArgs({ sessionId: 's1', agent: 'claude' });
    expect(args).not.toContain('--model');
  });

  it('buildGenerateComponentsArgs appends --model when provided', () => {
    const args = buildGenerateComponentsArgs({
      sessionId: 's1',
      agent: 'codex',
      model: 'gpt-5',
    });
    expect(args).toContain('--model');
    const idx = args.indexOf('--model');
    expect(args[idx + 1]).toBe('gpt-5');
  });

  it('buildGenerateComponentsArgs omits --model when not provided', () => {
    const args = buildGenerateComponentsArgs({ sessionId: 's1', agent: 'claude' });
    expect(args).not.toContain('--model');
  });
});
