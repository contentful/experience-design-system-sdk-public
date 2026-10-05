import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCliWithEnv } from '../helpers/cli-runner.js';
import {
  baseEnv,
  createScriptedAgent,
  createSessionFixture,
  generateTokensResponderSource,
  SAMPLE_TWO_COMPONENTS,
  type ScriptedAgent,
  type SessionFixture,
} from './scripted-agent-harness.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!().catch(() => {});
});

async function setup(): Promise<{ fixture: SessionFixture; agent: ScriptedAgent; tokensPath: string }> {
  const fixture = await createSessionFixture(SAMPLE_TWO_COMPONENTS);
  cleanups.push(fixture.cleanup);
  const agent = await createScriptedAgent(generateTokensResponderSource());
  cleanups.push(agent.cleanup);
  const tokensDir = await mkdtemp(join(tmpdir(), 'token-reruns-'));
  cleanups.push(() => rm(tokensDir, { recursive: true, force: true }));
  const tokensPath = join(tokensDir, 'tokens.scss');
  await writeFile(tokensPath, '$brand: #abcdef;\n', 'utf8');
  return { fixture, agent, tokensPath };
}

function tokenArgs(tokensPath: string, extra: string[] = []): string[] {
  return ['__generate', 'tokens', '--agent', 'claude', '--raw-tokens', tokensPath, ...extra];
}

describe('generate tokens reruns', () => {
  it('invokes the agent on every run, including repeat runs over identical tokens', async () => {
    const { fixture, agent, tokensPath } = await setup();
    const env = baseEnv(fixture, agent);

    const first = await runCliWithEnv(tokenArgs(tokensPath), env);
    const second = await runCliWithEnv(tokenArgs(tokensPath), env);

    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(await agent.callCount()).toBe(2);
    expect(second.stderr).not.toContain('reused from cache');
  });

  it('rejects --no-cache as an unknown option without invoking the agent', async () => {
    const { fixture, agent, tokensPath } = await setup();

    const result = await runCliWithEnv(tokenArgs(tokensPath, ['--no-cache']), baseEnv(fixture, agent));

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("unknown option '--no-cache'");
    expect(await agent.callCount()).toBe(0);
  });
});
