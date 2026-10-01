/**
 * Integration suite — generation_cache (Group 2).
 *
 * Drives `generate components` end-to-end. The fake claude binary emits one
 * classify_* tool call per prop/slot for every component it sees so the cache
 * row is actually persisted (storeCache only runs on non-zero tool calls).
 *
 * Bugs guarded:
 *   - PR #82: input_hash narrowed to extractor-only fields; description drift
 *     introduced by applyToolCalls must NOT change the hash on re-extract
 *     (tests 12, 15).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
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
import { resolveSkillPath } from '@contentful/experience-design-system-generation';
import { openPipelineDb } from '../../src/session/db.js';

const GEN_ARGS = (fix: CacheFixture, extra: string[] = []): string[] => [
  '__generate',
  'components',
  '--agent',
  'claude',
  '--session',
  fix.sessionId,
  ...extra,
];

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()!().catch(() => {});
});

async function setup(components = SAMPLE_TWO_COMPONENTS): Promise<{ fix: CacheFixture; agent: ScriptedAgent }> {
  const fix = await createCacheFixture(components);
  cleanups.push(fix.cleanup);
  const agent = await createScriptedAgent(generateComponentsResponderSource());
  cleanups.push(agent.cleanup);
  return { fix, agent };
}

describe('cache integration: generation_cache', () => {
  it('11. two runs on same session — 2nd is fully cached', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(GEN_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();
    expect(after1).toBe(SAMPLE_TWO_COMPONENTS.length);

    await runCliWithEnv(GEN_ARGS(fix), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(after1);
  });

  it('11a. restored cache hits can be handed to generation without a second lookup', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(GEN_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();

    const { sessionId: s2 } = await fix.extractAgain(SAMPLE_TWO_COMPONENTS);
    const nextFix = { ...fix, sessionId: s2 } as CacheFixture;
    const cacheStatus = await runCliWithEnv(
      GEN_ARGS(nextFix, ['--cache-status', '--restore-cache']),
      baseEnv(nextFix, agent),
    );
    const cachedNames = JSON.parse(/^cache-components=(.+)$/m.exec(cacheStatus.stdout)?.[1] ?? '[]') as string[];
    expect(cachedNames).toHaveLength(SAMPLE_TWO_COMPONENTS.length);

    await runCliWithEnv(
      GEN_ARGS(nextFix, ['--cached-components', JSON.stringify(cachedNames)]),
      baseEnv(nextFix, agent),
    );
    expect(await agent.callCount()).toBe(after1);
  });

  it('12. PR #82 — fresh session with identical sources reuses cache (no description drift)', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(GEN_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();

    // Re-extract identical components into a NEW session. The runOneComponent
    // path re-stores raw_components with no description set on props, but the
    // cache key now hashes only name/type, so the lookup must hit.
    const { sessionId: s2 } = await fix.extractAgain(SAMPLE_TWO_COMPONENTS);
    await runCliWithEnv(GEN_ARGS({ ...fix, sessionId: s2 } as CacheFixture), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(after1);
  });

  it('13. --no-cache forces every component to spawn the agent and writes no rows', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(GEN_ARGS(fix, ['--no-cache']), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(SAMPLE_TWO_COMPONENTS.length);
    expect(readGenerationCache(fix.dbPath)).toHaveLength(0);
  });

  it('14. changing a prop type → that component misses, others hit', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(GEN_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();

    const mutated = [
      {
        ...SAMPLE_TWO_COMPONENTS[0]!,
        props: [{ name: 'label', type: 'number', required: true }],
      },
      SAMPLE_TWO_COMPONENTS[1]!,
    ];
    const { sessionId: s2 } = await fix.extractAgain(mutated);
    await runCliWithEnv(GEN_ARGS({ ...fix, sessionId: s2 } as CacheFixture), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(after1 + 1);
  });

  it('15. PR #82 — JSDoc-only change (description) does NOT bust the cache', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(GEN_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();

    // computeComponentInputHash only hashes name/type/source/framework/slot
    // name+isDefault. Adding a description to a prop should not change the
    // hash. Re-extract the same components but with descriptions set.
    const withDocs = SAMPLE_TWO_COMPONENTS.map((c) => ({
      ...c,
      props: c.props.map((p) => ({
        ...p,
        description: 'jsdoc text added later',
      })),
    }));
    const { sessionId: s2 } = await fix.extractAgain(withDocs);
    await runCliWithEnv(GEN_ARGS({ ...fix, sessionId: s2 } as CacheFixture), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(after1);
  });

  it('16. different --generate-prompt-path → distinct prompt_hash rows', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(GEN_ARGS(fix), baseEnv(fix, agent));
    const promptHashes1 = new Set(readGenerationCache(fix.dbPath).map((r) => r.prompt_hash));
    expect(promptHashes1.size).toBe(1);

    const customDir = await mkdtemp(join(tmpdir(), 'cache-integ-gen-prompt-'));
    cleanups.push(() => rm(customDir, { recursive: true, force: true }));
    const customPath = join(customDir, 'custom-gen.md');
    const bundled = readFileSync(resolveSkillPath('components'), 'utf8');
    await writeFile(customPath, bundled + '\n<!-- harness override -->\n', 'utf8');

    await runCliWithEnv(GEN_ARGS(fix, ['--generate-prompt-path', customPath]), baseEnv(fix, agent));
    const promptHashes2 = new Set(readGenerationCache(fix.dbPath).map((r) => r.prompt_hash));
    expect(promptHashes2.size).toBe(2);
  });

  it('17. renaming a component → old row stays, new component misses', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(GEN_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();
    const rowsBefore = readGenerationCache(fix.dbPath);
    expect(rowsBefore.length).toBe(SAMPLE_TWO_COMPONENTS.length);

    const renamed = [{ ...SAMPLE_TWO_COMPONENTS[0]!, name: 'PrimaryButton' }, SAMPLE_TWO_COMPONENTS[1]!];
    const { sessionId: s2 } = await fix.extractAgain(renamed);
    await runCliWithEnv(GEN_ARGS({ ...fix, sessionId: s2 } as CacheFixture), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(after1 + 1);
    const rowsAfter = readGenerationCache(fix.dbPath);
    // Old Button row still present + new PrimaryButton row added (Card stays).
    expect(rowsAfter.length).toBeGreaterThan(rowsBefore.length);
  });

  it('18. adding a slot to a component → that component misses, rest hit', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(GEN_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();

    const extra = [
      {
        ...SAMPLE_TWO_COMPONENTS[0]!,
        slots: [{ name: 'icon', isDefault: false }],
      },
      SAMPLE_TWO_COMPONENTS[1]!,
    ];
    const { sessionId: s2 } = await fix.extractAgain(extra);
    await runCliWithEnv(GEN_ARGS({ ...fix, sessionId: s2 } as CacheFixture), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(after1 + 1);
  });

  it('19. normalizing an empty slot does not invalidate the cache on the next run', async () => {
    const components = [
      {
        ...SAMPLE_TWO_COMPONENTS[0]!,
        slots: [{ name: '', isDefault: false }],
      },
    ];
    const { fix, agent } = await setup(components);

    await runCliWithEnv(GEN_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();
    expect(after1).toBe(1);

    const cacheStatus = await runCliWithEnv(GEN_ARGS(fix, ['--cache-status']), baseEnv(fix, agent));
    expect(cacheStatus.stdout).toContain('cache-status=hit');

    await runCliWithEnv(GEN_ARGS(fix), baseEnv(fix, agent));
    expect(await agent.callCount()).toBe(after1);
  });

  it('20. an invalid cached child reference is treated as a cache miss and removed', async () => {
    const { fix, agent } = await setup();
    await runCliWithEnv(GEN_ARGS(fix), baseEnv(fix, agent));
    const after1 = await agent.callCount();

    const db = openPipelineDb(fix.dbPath);
    const cardId = (
      db
        .prepare(`SELECT component_id FROM raw_components WHERE session_id = ? AND name = 'Card'`)
        .get(fix.sessionId) as {
        component_id: string;
      }
    ).component_id;
    db.prepare(
      `INSERT INTO raw_slot_allowed_components (session_id, component_id, slot_name, allowed_component, position)
       VALUES (?, ?, 'children', 'Icon', 0)`,
    ).run(fix.sessionId, cardId);
    db.close();

    const next = await fix.extractAgain(SAMPLE_TWO_COMPONENTS);
    const nextFix = { ...fix, sessionId: next.sessionId } as CacheFixture;
    const cacheStatus = await runCliWithEnv(GEN_ARGS(nextFix, ['--cache-status']), baseEnv(nextFix, agent));
    expect(cacheStatus.stdout).toContain('cache-status=miss');

    await runCliWithEnv(GEN_ARGS(nextFix), baseEnv(nextFix, agent));
    expect(await agent.callCount()).toBe(after1 + 1);

    const checkDb = openPipelineDb(fix.dbPath);
    const nextCardId = (
      checkDb
        .prepare(`SELECT component_id FROM raw_components WHERE session_id = ? AND name = 'Card'`)
        .get(next.sessionId) as {
        component_id: string;
      }
    ).component_id;
    const rows = checkDb
      .prepare(
        `SELECT allowed_component FROM raw_slot_allowed_components WHERE session_id = ? AND component_id = ? AND slot_name = 'children'`,
      )
      .all(next.sessionId, nextCardId) as Array<{ allowed_component: string }>;
    expect(rows).toEqual([]);
    checkDb.close();
  });
});
