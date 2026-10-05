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

describe('resolveBinary', () => {
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

  it('maps claude → claude', () => expect(resolveBinary('claude')).toBe('claude'));
  it('maps codex → codex', () => expect(resolveBinary('codex')).toBe('codex'));
  it('maps opencode → opencode', () => expect(resolveBinary('opencode')).toBe('opencode'));
  it('maps cursor → cursor-agent', () => expect(resolveBinary('cursor')).toBe('cursor-agent'));
  it('maps copilot → copilot', () => expect(resolveBinary('copilot')).toBe('copilot'));

  it('honors EDS_AGENT_BINARY_CLAUDE override', () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = '/opt/custom/claude';
    expect(resolveBinary('claude')).toBe('/opt/custom/claude');
  });

  it('trims whitespace in override values', () => {
    process.env.EDS_AGENT_BINARY_CODEX = '  /usr/local/bin/codex  ';
    expect(resolveBinary('codex')).toBe('/usr/local/bin/codex');
  });

  it('falls through to default when override is empty/blank', () => {
    process.env.EDS_AGENT_BINARY_OPENCODE = '   ';
    expect(resolveBinary('opencode')).toBe('opencode');
  });

  it('override is per-agent (setting claude does not affect cursor)', () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = '/opt/x/claude';
    expect(resolveBinary('cursor')).toBe('cursor-agent');
  });
});

describe('resolveAgentModel', () => {
  const ENV_KEYS = [
    'EDS_AGENT_MODEL_CLAUDE',
    'EDS_AGENT_MODEL_CODEX',
    'EDS_AGENT_MODEL_OPENCODE',
    'EDS_AGENT_MODEL_CURSOR',
    'EDS_AGENT_MODEL_COPILOT',
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

  it('returns the explicit model when provided', () => expect(resolveAgentModel('claude', 'opus')).toBe('opus'));
  it('trims the explicit model', () => expect(resolveAgentModel('claude', '  opus  ')).toBe('opus'));
  it('falls back to EDS_AGENT_MODEL_<AGENT> when no explicit model', () => {
    process.env.EDS_AGENT_MODEL_CURSOR = 'sonnet-4';
    expect(resolveAgentModel('cursor')).toBe('sonnet-4');
  });
  it('explicit model wins over env', () => {
    process.env.EDS_AGENT_MODEL_CODEX = 'gpt-x';
    expect(resolveAgentModel('codex', 'gpt-y')).toBe('gpt-y');
  });
  it('returns the DEFAULT_MODELS entry when neither explicit nor env is set', () =>
    expect(resolveAgentModel('cursor')).toBe('gpt-mini'));
  it('leaves the Codex model unset when neither explicit nor env is set', () =>
    expect(resolveAgentModel('codex')).toBeUndefined());
  it('ignores blank env values and falls back to default', () => {
    process.env.EDS_AGENT_MODEL_OPENCODE = '   ';
    expect(resolveAgentModel('opencode')).toBe('claude-haiku-4-5');
  });

  it('returns the Bedrock-specific default for codex when bedrock is true', () => {
    expect(resolveAgentModel('codex', undefined, true)).toBe('openai.gpt-5.6-luna');
  });
  it('returns the amazon-bedrock-prefixed default for opencode when bedrock is true', () => {
    expect(resolveAgentModel('opencode', undefined, true)).toBe('amazon-bedrock/claude-haiku-4-5');
  });
  it('an EDS_AGENT_MODEL_<AGENT> override still wins over the Bedrock default', () => {
    process.env.EDS_AGENT_MODEL_CODEX = 'gpt-x';
    expect(resolveAgentModel('codex', undefined, true)).toBe('gpt-x');
  });
  it('bedrock does not affect claude or cursor defaults, which are unaffected by the flag', () => {
    expect(resolveAgentModel('claude', undefined, true)).toBe('haiku');
    expect(resolveAgentModel('cursor', undefined, true)).toBe('gpt-mini');
  });

  it('uses Auto default for copilot when neither explicit nor env is set', () =>
    expect(resolveAgentModel('copilot')).toBe('Auto'));
  it('honors EDS_AGENT_MODEL_COPILOT override', () => {
    process.env.EDS_AGENT_MODEL_COPILOT = 'gpt-5';
    expect(resolveAgentModel('copilot')).toBe('gpt-5');
  });
});

describe('buildArgs model handling', () => {
  it('uses default model for claude when none provided', () => {
    const args = buildArgs('claude', 'PROMPT');
    expect(args).toEqual(['--print', '--model', 'haiku', 'PROMPT']);
  });
  it('includes explicit --model for claude when provided', () => {
    expect(buildArgs('claude', 'PROMPT', 'opus')).toEqual(['--print', '--model', 'opus', 'PROMPT']);
  });
  it('uses gpt-mini default for cursor when no model provided', () => {
    expect(buildArgs('cursor', 'PROMPT')).toEqual(['--print', '--model', 'gpt-mini', 'PROMPT']);
  });
  it('preserves the Codex sandbox flag and lets Codex choose the default model', () => {
    const args = buildArgs('codex', 'PROMPT');
    expect(args).toEqual(['exec', '--dangerously-bypass-approvals-and-sandbox', 'PROMPT']);
  });
  it('inserts explicit --model before the codex sandbox flag', () => {
    expect(buildArgs('codex', 'PROMPT', 'gpt-5.5')).toEqual([
      'exec',
      '--model',
      'gpt-5.5',
      '--dangerously-bypass-approvals-and-sandbox',
      'PROMPT',
    ]);
  });
  it('omits the prompt positional when promptViaStdin is true', () => {
    expect(buildArgs('opencode', 'PROMPT', undefined, true)).toEqual(['run', '--model', 'claude-haiku-4-5']);
  });

  describe('bedrock', () => {
    const ENV_KEYS = ['AWS_REGION', 'AWS_DEFAULT_REGION'] as const;
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

    it('injects -c model_provider/region overrides for codex, defaulting region to us-east-1', () => {
      expect(buildArgs('codex', 'PROMPT', undefined, false, true)).toEqual([
        'exec',
        '-c',
        'model_provider=amazon-bedrock',
        '-c',
        'model_providers.amazon-bedrock.region=us-east-1',
        '--model',
        'openai.gpt-5.6-luna',
        '--dangerously-bypass-approvals-and-sandbox',
        'PROMPT',
      ]);
    });

    it('uses AWS_REGION over the us-east-1 default for codex', () => {
      process.env.AWS_REGION = 'eu-west-1';
      const args = buildArgs('codex', 'PROMPT', undefined, false, true);
      expect(args).toContain('model_providers.amazon-bedrock.region=eu-west-1');
    });

    it('does not add -c overrides for codex when bedrock is false', () => {
      const args = buildArgs('codex', 'PROMPT', undefined, false, false);
      expect(args).not.toContain('-c');
    });

    it('an explicit --model for codex overrides the Bedrock default id', () => {
      const args = buildArgs('codex', 'PROMPT', 'openai.gpt-5.6-sol', false, true);
      expect(args).toContain('openai.gpt-5.6-sol');
      expect(args).not.toContain('openai.gpt-5.6-luna');
    });

    it('prefixes the default opencode model with amazon-bedrock/', () => {
      expect(buildArgs('opencode', 'PROMPT', undefined, false, true)).toEqual([
        'run',
        '--model',
        'amazon-bedrock/claude-haiku-4-5',
        'PROMPT',
      ]);
    });

    it('does not prefix an explicit opencode --model', () => {
      expect(buildArgs('opencode', 'PROMPT', 'claude-sonnet-4-5', false, true)).toEqual([
        'run',
        '--model',
        'claude-sonnet-4-5',
        'PROMPT',
      ]);
    });

    it('leaves an already-prefixed opencode model untouched', () => {
      expect(resolveAgentModel('opencode', 'openai/gpt-5.6', true)).toBe('openai/gpt-5.6');
    });

    it('does not affect claude args (routed via env, not argv)', () => {
      expect(buildArgs('claude', 'PROMPT', undefined, false, true)).toEqual(['--print', '--model', 'haiku', 'PROMPT']);
    });
  });

  it('omits --model on the default (Auto) for copilot; prompt sits immediately after -p', () => {
    // Auto is a UI-only label — the CLI rejects --model Auto. Skipping
    // --model entirely is how you actually get Auto behavior.
    expect(buildArgs('copilot', 'PROMPT')).toEqual(['-p', 'PROMPT', '--allow-all-tools']);
  });
  it('includes explicit --model for copilot when a real model is provided', () => {
    expect(buildArgs('copilot', 'PROMPT', 'claude-sonnet-4.6')).toEqual([
      '-p',
      'PROMPT',
      '--model',
      'claude-sonnet-4.6',
      '--allow-all-tools',
    ]);
  });
  it('omits --model when EDS_AGENT_MODEL_COPILOT is explicitly set to Auto', () => {
    // Users who set the env override to "Auto" get the same behavior as no override.
    const prevModel = process.env['EDS_AGENT_MODEL_COPILOT'];
    process.env['EDS_AGENT_MODEL_COPILOT'] = 'Auto';
    try {
      expect(buildArgs('copilot', 'PROMPT')).toEqual(['-p', 'PROMPT', '--allow-all-tools']);
    } finally {
      if (prevModel === undefined) delete process.env['EDS_AGENT_MODEL_COPILOT'];
      else process.env['EDS_AGENT_MODEL_COPILOT'] = prevModel;
    }
  });
});

describe('agentSupportsBedrock', () => {
  it('returns true for claude', () => {
    expect(agentSupportsBedrock('claude')).toBe(true);
  });

  it('returns true for codex', () => {
    expect(agentSupportsBedrock('codex')).toBe(true);
  });

  it('returns true for opencode', () => {
    expect(agentSupportsBedrock('opencode')).toBe(true);
  });

  it('returns false for cursor, which has no working non-interactive Bedrock path', () => {
    expect(agentSupportsBedrock('cursor')).toBe(false);
  });

  it('returns false for copilot, which has no Bedrock routing mechanism yet', () => {
    expect(agentSupportsBedrock('copilot')).toBe(false);
  });
});
