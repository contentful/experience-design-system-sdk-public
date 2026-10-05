import { mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runAgent } from '../../../src/generate/adapters/local/local-agent-process.js';

describe('runAgent bedrock env', () => {
  let dir: string;
  const envKeys = [
    'EDS_AGENT_BINARY_CLAUDE',
    'EDS_AGENT_BINARY_CURSOR',
    'CLAUDE_CODE_USE_BEDROCK',
    'EDS_BEDROCK',
  ] as const;
  const saved: Partial<Record<(typeof envKeys)[number], string | undefined>> = {};

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'run-agent-bedrock-'));
    for (const key of envKeys) saved[key] = process.env[key];
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.EDS_BEDROCK;
  });
  afterEach(async () => {
    for (const key of envKeys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await rm(dir, { recursive: true, force: true });
  });

  async function makeEnvEchoBinary(): Promise<string> {
    const p = join(dir, 'echo-env');
    await writeFile(p, '#!/usr/bin/env node\nprocess.stdout.write(process.env.CLAUDE_CODE_USE_BEDROCK ?? "");\n');
    await chmod(p, 0o755);
    return p;
  }

  it('sets CLAUDE_CODE_USE_BEDROCK=1 in the child env when bedrock is true', async () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = await makeEnvEchoBinary();
    const result = await runAgent({ agent: 'claude', prompt: 'PROMPT', timeoutMs: 5000, bedrock: true });
    expect(result.stdout).toBe('1');
  });

  it('does not set CLAUDE_CODE_USE_BEDROCK when bedrock is omitted', async () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = await makeEnvEchoBinary();
    const result = await runAgent({ agent: 'claude', prompt: 'PROMPT', timeoutMs: 5000 });
    expect(result.stdout).toBe('');
  });

  it('is a no-op for an agent with no Bedrock env entry, even when bedrock is true', async () => {
    process.env.EDS_AGENT_BINARY_CURSOR = await makeEnvEchoBinary();
    const result = await runAgent({ agent: 'cursor', prompt: 'PROMPT', timeoutMs: 5000, bedrock: true });
    expect(result.stdout).toBe('');
  });

  it('falls back to EDS_BEDROCK=1 when bedrock is not passed explicitly', async () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = await makeEnvEchoBinary();
    process.env.EDS_BEDROCK = '1';
    const result = await runAgent({ agent: 'claude', prompt: 'PROMPT', timeoutMs: 5000 });
    expect(result.stdout).toBe('1');
  });

  it('an explicit bedrock: false overrides EDS_BEDROCK=1', async () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = await makeEnvEchoBinary();
    process.env.EDS_BEDROCK = '1';
    const result = await runAgent({ agent: 'claude', prompt: 'PROMPT', timeoutMs: 5000, bedrock: false });
    expect(result.stdout).toBe('');
  });

  it('ignores EDS_BEDROCK when set to a non-"1" value', async () => {
    process.env.EDS_AGENT_BINARY_CLAUDE = await makeEnvEchoBinary();
    process.env.EDS_BEDROCK = 'true';
    const result = await runAgent({ agent: 'claude', prompt: 'PROMPT', timeoutMs: 5000 });
    expect(result.stdout).toBe('');
  });
});
