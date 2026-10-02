import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkAgentAuth } from '../../src/generate/services/agent-auth-service.js';

const ENV_KEYS = ['EDS_AGENT_BINARY_CLAUDE', 'EDS_AGENT_BINARY_CODEX'] as const;
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

describe('agent auth service', () => {
  it('returns not-found for a missing configured binary', async () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = '/nonexistent/claude';

    await expect(checkAgentAuth('claude')).resolves.toBe('not-found');
  });

  it('treats a present non-Claude binary as authenticated without probing Claude', async () => {
    process.env.EDS_AGENT_BINARY_CODEX = process.execPath;
    process.env.EDS_AGENT_BINARY_CLAUDE = '/nonexistent/claude';

    await expect(checkAgentAuth('codex')).resolves.toBe('ok');
  });
});
