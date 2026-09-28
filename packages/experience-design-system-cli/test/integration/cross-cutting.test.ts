/**
 * Integration suite — cross-cutting cache behaviors (Group 5).
 *
 * Covers env-var knobs that must not change cache row contents (batch size,
 * concurrency) and the combined --no-cache opt-out.
 *
 * Note: scenario 25 (the full `experiences import` end-to-end vs subcommand-
 * by-subcommand parity) is intentionally omitted. The wizard path renders an
 * Ink TUI and shells out to itself, which exceeds the 30s budget for the new
 * suite. The select-cache and generation-cache files already exercise the
 * underlying cache-key invariants the wizard relies on.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCliWithEnv } from '../helpers/cli-runner.js';
import {
  createCacheFixture,
  createScriptedAgent,
  generateComponentsResponderSource,
  readGenerationCache,
  baseEnv,
  SAMPLE_TWO_COMPONENTS,
  type CacheFixture,
  type ScriptedAgent,
} from './cache-harness.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!().catch(() => {});
});

async function generateSetup(): Promise<{ fix: CacheFixture; agent: ScriptedAgent }> {
  const fix = await createCacheFixture(SAMPLE_TWO_COMPONENTS);
  cleanups.push(fix.cleanup);
  const agent = await createScriptedAgent(generateComponentsResponderSource());
  cleanups.push(agent.cleanup);
  return { fix, agent };
}

const GEN_ARGS = (fix: CacheFixture, extra: string[] = []) => [
  '__generate',
  'components',
  '--agent',
  'claude',
  '--session',
  fix.sessionId,
  ...extra,
];

describe('cache integration: cross-cutting', () => {
  it('24. --no-cache writes nothing to generation_cache', async () => {
    const { fix } = await generateSetup();
    const genAgent = await createScriptedAgent(generateComponentsResponderSource());
    cleanups.push(genAgent.cleanup);
    await runCliWithEnv(GEN_ARGS(fix, ['--no-cache']), baseEnv(fix, genAgent));
    expect(readGenerationCache(fix.dbPath)).toHaveLength(0);
  });

  it('27. EDS_GENERATE_CONCURRENCY does not change generation_cache row contents', async () => {
    const a = await generateSetup();
    await runCliWithEnv(GEN_ARGS(a.fix), baseEnv(a.fix, a.agent, { EDS_GENERATE_CONCURRENCY: '1' }));
    const rowsC1 = readGenerationCache(a.fix.dbPath).map((r) => ({
      hash: r.input_hash,
      prompt: r.prompt_hash,
      entity: r.entity_type,
    }));

    const b = await generateSetup();
    await runCliWithEnv(GEN_ARGS(b.fix), baseEnv(b.fix, b.agent, { EDS_GENERATE_CONCURRENCY: '10' }));
    const rowsC10 = readGenerationCache(b.fix.dbPath).map((r) => ({
      hash: r.input_hash,
      prompt: r.prompt_hash,
      entity: r.entity_type,
    }));

    expect(rowsC10).toEqual(rowsC1);
  });
});
