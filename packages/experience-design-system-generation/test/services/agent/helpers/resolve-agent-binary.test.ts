import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAgentBinary } from '../../../../src/services/agent/helpers/resolve-agent-binary.js';

const ENV_KEYS = [
  'EDS_AGENT_BINARY_CLAUDE',
  'EDS_AGENT_BINARY_CODEX',
  'EDS_AGENT_BINARY_OPENCODE',
  'EDS_AGENT_BINARY_CURSOR',
  'EDS_AGENT_BINARY_COPILOT',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('resolveAgentBinary', () => {
  it('maps claude → claude', () => expect(resolveAgentBinary('claude')).toBe('claude'));
  it('maps codex → codex', () => expect(resolveAgentBinary('codex')).toBe('codex'));
  it('maps opencode → opencode', () => expect(resolveAgentBinary('opencode')).toBe('opencode'));
  it('maps cursor → cursor-agent', () => expect(resolveAgentBinary('cursor')).toBe('cursor-agent'));
  it('maps copilot → copilot', () => expect(resolveAgentBinary('copilot')).toBe('copilot'));

  it('honors EDS_AGENT_BINARY_CLAUDE override', () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = '/opt/custom/claude';
    expect(resolveAgentBinary('claude')).toBe('/opt/custom/claude');
  });

  it('trims whitespace in override values', () => {
    process.env.EDS_AGENT_BINARY_CODEX = '  /usr/local/bin/codex  ';
    expect(resolveAgentBinary('codex')).toBe('/usr/local/bin/codex');
  });

  it('falls through to default when override is empty/blank', () => {
    process.env.EDS_AGENT_BINARY_OPENCODE = '   ';
    expect(resolveAgentBinary('opencode')).toBe('opencode');
  });

  it('override is per-agent (setting claude does not affect cursor)', () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = '/opt/x/claude';
    expect(resolveAgentBinary('cursor')).toBe('cursor-agent');
  });
});
