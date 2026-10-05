import { afterEach, describe, expect, it } from 'vitest';
import { runCliWithEnv } from '../helpers/cli-runner.js';
import {
  baseEnv,
  createScriptedAgent,
  createSessionFixture,
  generateComponentsResponderSource,
  SAMPLE_TWO_COMPONENTS,
  type ScriptedAgent,
  type SessionFixture,
} from './scripted-agent-harness.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!().catch(() => {});
});

async function setup(): Promise<{
  fixture: SessionFixture;
  agent: ScriptedAgent;
  env: Record<string, string>;
}> {
  const fixture = await createSessionFixture(SAMPLE_TWO_COMPONENTS);
  cleanups.push(fixture.cleanup);
  const agent = await createScriptedAgent(generateComponentsResponderSource());
  cleanups.push(agent.cleanup);
  const env = baseEnv(fixture, agent);
  return { fixture, agent, env };
}

function generateArgs(sessionId: string, extra: string[] = []): string[] {
  return ['__generate', 'components', '--agent', 'claude', '--session', sessionId, ...extra];
}

describe('generate components reruns', () => {
  it('invokes the agent for every component on a second run over the same session', async () => {
    const { fixture, agent, env } = await setup();

    await runCliWithEnv(generateArgs(fixture.sessionId), env);
    expect(await agent.callCount()).toBe(SAMPLE_TWO_COMPONENTS.length);

    const second = await runCliWithEnv(generateArgs(fixture.sessionId), env);

    expect(second.code).toBe(0);
    expect(await agent.callCount()).toBe(SAMPLE_TWO_COMPONENTS.length * 2);
    expect(second.stderr).not.toContain('cached');
  });

  it('invokes the agent again when an identical project is re-extracted into a new session', async () => {
    const { fixture, agent, env } = await setup();

    await runCliWithEnv(generateArgs(fixture.sessionId), env);
    const { sessionId } = await fixture.extractAgain(SAMPLE_TWO_COMPONENTS);
    await runCliWithEnv(generateArgs(sessionId), env);

    expect(await agent.callCount()).toBe(SAMPLE_TWO_COMPONENTS.length * 2);
  });

  it('makes exactly one agent call per component', async () => {
    const { fixture, agent, env } = await setup();

    await runCliWithEnv(generateArgs(fixture.sessionId), env);

    expect(await agent.callCount()).toBe(SAMPLE_TWO_COMPONENTS.length);
  });

  it.each(['--no-cache', '--cache-status', '--restore-cache', '--classification-agent-count'])(
    'rejects %s as an unknown option',
    async (flag) => {
      const { fixture, agent, env } = await setup();

      const result = await runCliWithEnv(generateArgs(fixture.sessionId, [flag]), env);

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain(`unknown option '${flag}'`);
      expect(await agent.callCount()).toBe(0);
    },
  );

  it('rejects --cached-components as an unknown option', async () => {
    const { fixture, env } = await setup();

    const result = await runCliWithEnv(generateArgs(fixture.sessionId, ['--cached-components', '["Button"]']), env);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("unknown option '--cached-components'");
  });

  it('ignores EDS_NO_CACHE because there is nothing left to bypass', async () => {
    const { fixture, agent, env } = await setup();

    const result = await runCliWithEnv(generateArgs(fixture.sessionId), { ...env, EDS_NO_CACHE: '1' });

    expect(result.code).toBe(0);
    expect(await agent.callCount()).toBe(SAMPLE_TWO_COMPONENTS.length);
  });
});
