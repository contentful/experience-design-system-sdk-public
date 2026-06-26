/**
 * Integration suite — token cache (Group 4).
 *
 * `generate tokens` stores into generation_cache with entity_type='token_set'
 * and entity_id='__tokens__', keyed by sha256(rawTokenContent.trim()) and the
 * tokens-skill prompt_hash.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCliWithEnv } from '../helpers/cli-runner.js';
import {
  createCacheFixture,
  createScriptedAgent,
  generateTokensResponderSource,
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

async function setup(): Promise<{
  fix: CacheFixture;
  agent: ScriptedAgent;
  tokensPath: string;
}> {
  const fix = await createCacheFixture(SAMPLE_TWO_COMPONENTS);
  cleanups.push(fix.cleanup);
  const agent = await createScriptedAgent(generateTokensResponderSource());
  cleanups.push(agent.cleanup);
  const tokensDir = await mkdtemp(join(tmpdir(), 'cache-integ-tokens-'));
  cleanups.push(() => rm(tokensDir, { recursive: true, force: true }));
  await mkdir(tokensDir, { recursive: true });
  const tokensPath = join(tokensDir, 'tokens.scss');
  await writeFile(tokensPath, '$brand: #abcdef;\n', 'utf8');
  return { fix, agent, tokensPath };
}

const TOKEN_ARGS = (_fix: CacheFixture, tokensPath: string, extra: string[] = []): string[] => [
  'generate',
  'tokens',
  '--agent',
  'claude',
  '--raw-tokens',
  tokensPath,
  ...extra,
];

describe('cache integration: token cache (generation_cache token_set entries)', () => {
  it('21. two runs on identical tokens — 2nd reuses the cached token_set row', async () => {
    const { fix, agent, tokensPath } = await setup();
    await runCliWithEnv(TOKEN_ARGS(fix, tokensPath), baseEnv(fix, agent));
    const after1 = await agent.callCount();
    expect(after1).toBe(1);
    const rows1 = readGenerationCache(fix.dbPath).filter((r) => r.entity_type === 'token_set');
    expect(rows1).toHaveLength(1);

    await runCliWithEnv(TOKEN_ARGS(fix, tokensPath), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(after1);
  });

  it('22. editing the raw tokens file → cache miss, new input_hash row appears', async () => {
    const { fix, agent, tokensPath } = await setup();
    await runCliWithEnv(TOKEN_ARGS(fix, tokensPath), baseEnv(fix, agent));
    const after1 = await agent.callCount();
    const beforeHashes = new Set(
      readGenerationCache(fix.dbPath).filter((r) => r.entity_type === 'token_set').map((r) => r.input_hash),
    );

    await writeFile(tokensPath, '$brand: #ffffff;\n$secondary: #000000;\n', 'utf8');
    await runCliWithEnv(TOKEN_ARGS(fix, tokensPath), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(after1 + 1);
    const afterHashes = new Set(
      readGenerationCache(fix.dbPath).filter((r) => r.entity_type === 'token_set').map((r) => r.input_hash),
    );
    expect(afterHashes.size).toBeGreaterThan(beforeHashes.size);
  });

  it('23. --no-cache prevents writes and forces fresh agent call', async () => {
    const { fix, agent, tokensPath } = await setup();
    await runCliWithEnv(TOKEN_ARGS(fix, tokensPath, ['--no-cache']), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(1);
    const tokenRows = readGenerationCache(fix.dbPath).filter((r) => r.entity_type === 'token_set');
    expect(tokenRows).toHaveLength(0);
  });
});
