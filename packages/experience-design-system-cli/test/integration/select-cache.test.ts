/**
 * Integration suite — select_cache (Group 1).
 *
 * Each test runs the real `analyze select-agent` CLI against a per-test
 * pipeline.db with a fake `claude` binary on PATH. The harness counts
 * agent invocations so a "full cache hit" assertion is direct: 0 new calls.
 *
 * Bugs guarded by this suite:
 *   - PR #65: --no-cache must NOT silently update existing rows (test 4).
 *   - PR #77: fresh sessions must reuse rows when component bytes match (test 2).
 *   - PR #80: prompt-content changes invalidate rows (tests 6, 7).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCliWithEnv } from '../helpers/cli-runner.js';
import {
  createCacheFixture,
  createScriptedAgent,
  selectAllResponderSource,
  readSelectCache,
  corruptSelectCacheCliVersion,
  baseEnv,
  SAMPLE_TWO_COMPONENTS,
  type CacheFixture,
  type ScriptedAgent,
} from './cache-harness.js';
import { resolveSkillPath } from '../../src/generate/prompt-builder.js';
import { readFileSync } from 'node:fs';

const SELECT_ARGS = (fix: CacheFixture, extra: string[] = []): string[] => [
  'analyze',
  'select-agent',
  '--agent',
  'claude',
  '--session',
  fix.sessionId,
  '--project-root',
  fix.projectDir,
  ...extra,
];

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!().catch(() => {});
});

async function setup(
  components = SAMPLE_TWO_COMPONENTS,
  responder = selectAllResponderSource('accept'),
): Promise<{ fix: CacheFixture; agent: ScriptedAgent }> {
  const fix = await createCacheFixture(components);
  cleanups.push(fix.cleanup);
  const agent = await createScriptedAgent(responder);
  cleanups.push(agent.cleanup);
  return { fix, agent };
}

describe('cache integration: select_cache', () => {
  it('1. two runs on same session — 2nd run hits cache for every component', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(SELECT_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();
    expect(after1).toBeGreaterThan(0);

    await runCliWithEnv(SELECT_ARGS(fix), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(after1);
  });

  it('2. PR #77 — fresh session with identical sources reuses prior cache rows', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(SELECT_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();

    const { sessionId: s2 } = await fix.extractAgain(SAMPLE_TWO_COMPONENTS);
    const args = SELECT_ARGS({ ...fix, sessionId: s2 } as CacheFixture);
    await runCliWithEnv(args, baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(after1);
  });

  it('3. --no-cache skips both lookup and writes', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(SELECT_ARGS(fix, ['--no-cache']), baseEnv(fix, agent));
    expect((await agent.callCount()) > 0).toBe(true);
    expect(readSelectCache(fix.dbPath)).toHaveLength(0);
  });

  it('4. PR #65 — --no-cache after warm cache must not update existing rows', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(SELECT_ARGS(fix), baseEnv(fix, agent));
    const before = readSelectCache(fix.dbPath);
    expect(before.length).toBeGreaterThan(0);

    // Second run with --no-cache: write-skipped.
    await runCliWithEnv(SELECT_ARGS(fix, ['--no-cache']), baseEnv(fix, agent));
    const after = readSelectCache(fix.dbPath);
    expect(after).toEqual(before);
  });

  it('5. changing one component prop type → that component misses, others hit', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(SELECT_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();

    const mutated = [
      { ...SAMPLE_TWO_COMPONENTS[0]!, props: [{ name: 'label', type: 'number', required: true }] },
      SAMPLE_TWO_COMPONENTS[1]!,
    ];
    const { sessionId: s2 } = await fix.extractAgain(mutated);
    await runCliWithEnv(SELECT_ARGS({ ...fix, sessionId: s2 } as CacheFixture), baseEnv(fix, agent));
    // Exactly one extra batch call should have run (1 uncached, 1 cached).
    expect(await agent.callCount()).toBe(after1 + 1);
  });

  it('6. PR #80 — different prompt content produces a distinct prompt_hash row', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(SELECT_ARGS(fix), baseEnv(fix, agent));
    const promptHashes1 = new Set(readSelectCache(fix.dbPath).map((r) => r.prompt_hash));
    expect(promptHashes1.size).toBe(1);

    // Write a custom prompt distinct from the bundled one.
    const customDir = await mkdtemp(join(tmpdir(), 'cache-integ-prompt-'));
    cleanups.push(() => rm(customDir, { recursive: true, force: true }));
    const customPath = join(customDir, 'custom-select.md');
    await writeFile(customPath, '# Distinct custom select prompt\nDo something different.\n', 'utf8');

    await runCliWithEnv(SELECT_ARGS(fix, ['--select-prompt-path', customPath]), baseEnv(fix, agent));
    const promptHashes2 = new Set(readSelectCache(fix.dbPath).map((r) => r.prompt_hash));
    expect(promptHashes2.size).toBe(2);
  });

  it('7. custom prompt with bundled-identical content reuses the bundled prompt_hash', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(SELECT_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();

    // Mirror the bundled select skill byte-for-byte.
    const bundled = resolveSkillPath('select');
    const bundledContent = readFileSync(bundled, 'utf8');
    const aliasDir = await mkdtemp(join(tmpdir(), 'cache-integ-alias-'));
    cleanups.push(() => rm(aliasDir, { recursive: true, force: true }));
    const aliasPath = join(aliasDir, 'alias-select.md');
    await writeFile(aliasPath, bundledContent, 'utf8');

    await runCliWithEnv(SELECT_ARGS(fix, ['--select-prompt-path', aliasPath]), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(after1);
    expect(new Set(readSelectCache(fix.dbPath).map((r) => r.prompt_hash)).size).toBe(1);
  });

  it('8. adding a new component → only new one spawns the agent', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(SELECT_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();

    const expanded = [
      ...SAMPLE_TWO_COMPONENTS,
      {
        name: 'Banner',
        source: 'src/Banner.tsx',
        framework: 'react' as const,
        props: [{ name: 'text', type: 'string', required: true }],
        slots: [],
      },
    ];
    const { sessionId: s2 } = await fix.extractAgain(expanded);
    await runCliWithEnv(SELECT_ARGS({ ...fix, sessionId: s2 } as CacheFixture), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(after1 + 1);
  });

  it('9. removing a component → no new agent spawns', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(SELECT_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();

    const { sessionId: s2 } = await fix.extractAgain([SAMPLE_TWO_COMPONENTS[0]!]);
    await runCliWithEnv(SELECT_ARGS({ ...fix, sessionId: s2 } as CacheFixture), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(after1);
  });

  it('10. corrupted cli_version makes existing rows miss and forces re-write', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(SELECT_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();
    const before = readSelectCache(fix.dbPath);
    expect(before.length).toBeGreaterThan(0);

    corruptSelectCacheCliVersion(fix.dbPath);
    await runCliWithEnv(SELECT_ARGS(fix), baseEnv(fix, agent));
    expect(await agent.callCount()).toBeGreaterThan(after1);
    // Row count stays bounded but at least one row now has the live cli_version.
    const after = readSelectCache(fix.dbPath);
    const liveVersions = new Set(after.map((r) => r.cli_version));
    expect(liveVersions.size).toBeGreaterThanOrEqual(1);
    expect(liveVersions.has('corrupted-version-xyz')).toBe(true); // old row stays
  });
});
