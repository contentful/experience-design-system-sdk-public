import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  agentSupportsBedrock,
  buildArgs,
  resolveAgentEnvironment,
  resolveAgentModel,
  resolveBinary,
} from '../../src/generate/services/agent-configuration-service.js';

const ENV_KEYS = [
  'EDS_AGENT_BINARY_CLAUDE',
  'EDS_AGENT_BINARY_CURSOR',
  'EDS_AGENT_MODEL_CLAUDE',
  'EDS_AGENT_MODEL_CODEX',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('agent configuration service', () => {
  it('resolves binary overrides per agent', () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = '  /opt/custom/claude  ';

    expect(resolveBinary('claude')).toBe('/opt/custom/claude');
    expect(resolveBinary('cursor')).toBe('cursor-agent');
  });

  it('preserves model precedence and Bedrock defaults', () => {
    process.env.EDS_AGENT_MODEL_CODEX = 'env-model';

    expect(resolveAgentModel('codex', 'explicit-model', true)).toBe('explicit-model');
    expect(resolveAgentModel('codex', undefined, true)).toBe('env-model');
    delete process.env.EDS_AGENT_MODEL_CODEX;
    expect(resolveAgentModel('codex', undefined, true)).toBe('openai.gpt-5.6-luna');
    expect(resolveAgentModel('opencode', undefined, true)).toBe('amazon-bedrock/claude-haiku-4-5');
  });

  it('keeps agent-specific argument ordering and Copilot Auto behavior', () => {
    expect(buildArgs('codex', 'PROMPT', undefined, true, true)).toEqual([
      'exec',
      '-c',
      'model_provider=amazon-bedrock',
      '-c',
      'model_providers.amazon-bedrock.region=us-east-1',
      '--model',
      'openai.gpt-5.6-luna',
      '--dangerously-bypass-approvals-and-sandbox',
    ]);
    expect(buildArgs('copilot', 'PROMPT')).toEqual(['-p', 'PROMPT', '--allow-all-tools']);
  });

  it('exposes only supported Bedrock routes and their environment policy', () => {
    expect(agentSupportsBedrock('claude')).toBe(true);
    expect(agentSupportsBedrock('cursor')).toBe(false);
    expect(resolveAgentEnvironment('claude', true)).toEqual({ CLAUDE_CODE_USE_BEDROCK: '1' });
    expect(resolveAgentEnvironment('cursor', true)).toBeUndefined();
  });
});
