import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('checkAgentAuth', () => {
  let dir: string;
  const ENV_KEYS = [
    'EDS_AGENT_BINARY_CLAUDE',
    'EDS_AGENT_BINARY_CODEX',
    'EDS_AGENT_BINARY_OPENCODE',
    'EDS_AGENT_BINARY_CURSOR',
    'EDS_AGENT_BINARY_COPILOT',
  ] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'auth-check-'));
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await rm(dir, { recursive: true, force: true });
  });

  async function stub(name: string): Promise<string> {
    const p = join(dir, name);
    // Minimal executable that exits 0; must never be invoked for non-claude.
    await writeFile(p, '#!/usr/bin/env node\nprocess.exit(0);\n');
    await chmod(p, 0o755);
    return p;
  }

  it('returns ok for a present non-claude binary without running claude', async () => {
    process.env.EDS_AGENT_BINARY_CODEX = await stub('codex');
    // Point claude at a path that would fail loudly if invoked.
    process.env.EDS_AGENT_BINARY_CLAUDE = '/nonexistent/claude-should-not-run';
    await expect(checkAgentAuth('codex')).resolves.toBe('ok');
  });

  it('returns not-found when a non-claude binary is absent (no silent ok)', async () => {
    process.env.EDS_AGENT_BINARY_CURSOR = join(dir, 'does-not-exist-cursor');
    await expect(checkAgentAuth('cursor')).resolves.toBe('not-found');
  });

  it('returns not-found for claude when the claude binary is absent', async () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = join(dir, 'does-not-exist-claude');
    await expect(checkAgentAuth('claude')).resolves.toBe('not-found');
  });
});
