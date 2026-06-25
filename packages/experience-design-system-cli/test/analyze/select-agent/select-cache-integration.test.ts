import { describe, it, expect, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runCliWithEnv } from '../../helpers/cli-runner.js';
import { createTestFixture, type TestFixture } from '../../helpers/fixtures.js';
import { mkdtemp, rm, writeFile, chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

type ScriptedAgent = { countFile: string; cleanup: () => Promise<void>; env: () => Record<string, string> };

async function createScriptedAgent(agentName: string, outputs: string[]): Promise<ScriptedAgent> {
  const dir = await mkdtemp(join(tmpdir(), 'mock-select-cache-'));
  const countFile = join(dir, 'count.txt');
  const script = join(dir, agentName);
  const fallbackOutput = outputs.at(-1) ?? '{"tool":"reject_component","name":"X","reason":"none"}';
  const cases = outputs
    .map((output, i) => `  ${i + 1})\n    cat <<'EOF'\n${output}\nEOF\n    ;;`)
    .join('\n');
  const content = `#!/usr/bin/env bash
COUNT_FILE='${countFile}'
n=$(cat "$COUNT_FILE" 2>/dev/null || echo 0)
n=$((n+1))
echo "$n" > "$COUNT_FILE"
case "$n" in
${cases}
  *)
    cat <<'EOF'
${fallbackOutput}
EOF
    ;;
esac
exit 0
`;
  await writeFile(script, content);
  await chmod(script, 0o755);
  return {
    countFile,
    cleanup: () => rm(dir, { recursive: true, force: true }),
    env: () => ({ PATH: `${dir}:${process.env.PATH ?? ''}` }),
  };
}

const cleanupItems: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanupItems.length > 0) {
    const c = cleanupItems.pop();
    if (c) await c().catch(() => {});
  }
});

async function setupOne(name = 'Button'): Promise<{ fixture: TestFixture; artifactsDir: string }> {
  const fixture = await createTestFixture([
    {
      name,
      source: `src/${name}.tsx`,
      framework: 'react',
      props: [{ name: 'label', type: 'string', required: true }],
      slots: [],
    },
  ]);
  cleanupItems.push(fixture.cleanup);
  const artifactsDir = await mkdtemp(join(tmpdir(), 'select-cache-artifacts-'));
  await mkdir(artifactsDir, { recursive: true });
  cleanupItems.push(() => rm(artifactsDir, { recursive: true, force: true }));
  return { fixture, artifactsDir };
}

function baseEnv(fixture: TestFixture, artifactsDir: string, extra: Record<string, string>): Record<string, string> {
  return {
    ...process.env,
    ...extra,
    EDS_PIPELINE_DB_PATH: fixture.dbPath,
    EDS_REFINE_ARTIFACTS_ROOT: artifactsDir,
  };
}

describe('select-agent fine-grained cache', () => {
  it('second run with same prompt + same component performs zero LLM calls', async () => {
    const { fixture, artifactsDir } = await setupOne('Button');
    const agent = await createScriptedAgent('claude', [
      '{"tool":"select_component","name":"Button","reason":"primary UI","confidence":5}',
    ]);
    cleanupItems.push(agent.cleanup);

    const args = [
      'analyze',
      'select-agent',
      '--agent',
      'claude',
      '--session',
      fixture.sessionId,
      '--project-root',
      fixture.projectDir,
    ];

    const r1 = await runCliWithEnv(args, baseEnv(fixture, artifactsDir, agent.env()));
    expect(r1.code).toBe(0);
    const callsAfterFirst = Number((await readFile(agent.countFile, 'utf8')).trim());
    expect(callsAfterFirst).toBeGreaterThan(0);

    const r2 = await runCliWithEnv(args, baseEnv(fixture, artifactsDir, agent.env()));
    expect(r2.code).toBe(0);
    const callsAfterSecond = Number((await readFile(agent.countFile, 'utf8')).trim());
    // Second invocation should have made zero additional LLM calls.
    expect(callsAfterSecond).toBe(callsAfterFirst);
    expect(r2.stderr).toContain('cached');
  });

  it('--no-cache forces a fresh LLM call even when a cache hit exists', async () => {
    const { fixture, artifactsDir } = await setupOne('Card');
    const agent = await createScriptedAgent('claude', [
      '{"tool":"select_component","name":"Card","reason":"first","confidence":5}',
      '{"tool":"select_component","name":"Card","reason":"second","confidence":5}',
    ]);
    cleanupItems.push(agent.cleanup);

    const args = [
      'analyze',
      'select-agent',
      '--agent',
      'claude',
      '--session',
      fixture.sessionId,
      '--project-root',
      fixture.projectDir,
    ];

    await runCliWithEnv(args, baseEnv(fixture, artifactsDir, agent.env()));
    const first = Number((await readFile(agent.countFile, 'utf8')).trim());

    await runCliWithEnv([...args, '--no-cache'], baseEnv(fixture, artifactsDir, agent.env()));
    const second = Number((await readFile(agent.countFile, 'utf8')).trim());
    expect(second).toBeGreaterThan(first);
  });
});
