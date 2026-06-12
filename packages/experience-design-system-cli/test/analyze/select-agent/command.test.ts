import { describe, it, expect, afterEach } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCliWithEnv } from '../../helpers/cli-runner.js';
import { createTestFixture, type TestFixture } from '../../helpers/fixtures.js';
import { HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON } from '../../../src/analyze/extract/source-inspection.js';

type ScriptedAgent = {
  countFile: string;
  cleanup: () => Promise<void>;
  env: () => Record<string, string>;
};

async function createScriptedAgent(agentName: string, outputs: string[]): Promise<ScriptedAgent> {
  const dir = await mkdtemp(join(tmpdir(), 'mock-select-agent-'));
  const countFile = join(dir, 'count.txt');
  const script = join(dir, agentName);
  const fallbackOutput =
    outputs.at(-1) ?? '{"tool":"reject_component","name":"Unknown","reason":"no output","confidence":1}';
  const cases = outputs
    .map(
      (output, i) => `  ${i + 1})
    cat <<'EOF'
${output}
EOF
    ;;`,
    )
    .join('\n');

  await writeFile(
    script,
    `#!/bin/sh
COUNT_FILE="${'${'}EDS_AGENT_COUNT_FILE:-${countFile}}"
if [ ! -f "$COUNT_FILE" ]; then printf '0' > "$COUNT_FILE"; fi
COUNT=$(cat "$COUNT_FILE")
NEXT=$((COUNT + 1))
printf '%s' "$NEXT" > "$COUNT_FILE"
case "$NEXT" in
${cases}
  *)
    cat <<'EOF'
${fallbackOutput}
EOF
    ;;
esac
`,
    'utf8',
  );
  await chmod(script, '755');

  return {
    countFile,
    cleanup: () => rm(dir, { recursive: true, force: true }),
    env: () => ({
      PATH: `${dir}:${process.env.PATH}`,
      EDS_AGENT_COUNT_FILE: countFile,
    }),
  };
}

type ReviewState = {
  components: Array<{ name: string; status: string }>;
};

type EventLine = { type: string; payload: { status: string; component: string } };

const cleanupItems: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanupItems.splice(0).map((fn) => fn()));
});

async function setup(components = undefined as Parameters<typeof createTestFixture>[0]) {
  const fixture = await createTestFixture(components);
  const artifactsDir = await mkdtemp(join(tmpdir(), 'select-agent-artifacts-'));
  cleanupItems.push(fixture.cleanup, () => rm(artifactsDir, { recursive: true, force: true }));
  return { fixture, artifactsDir };
}

function baseEnv(fixture: TestFixture, artifactsDir: string, agentEnv: Record<string, string>) {
  return {
    EDS_PIPELINE_DB_PATH: fixture.dbPath,
    EDS_REVIEW_ARTIFACTS_DIR: artifactsDir,
    NODE_NO_WARNINGS: '1',
    ...agentEnv,
  };
}

// ── Single accepted component ────────────────────────────────────────────────

describe('select-agent command — decision persistence', () => {
  it('persists accepted status when agent selects the component', async () => {
    const { fixture, artifactsDir } = await setup([
      {
        name: 'Button',
        source: 'src/Button.tsx',
        framework: 'react',
        props: [{ name: 'label', type: 'string', required: true }],
        slots: [],
        extractionConfidence: 5,
        needsReview: false,
      },
    ]);

    const agent = await createScriptedAgent('claude', [
      '{"tool":"select_component","name":"Button","reason":"visible UI component","confidence":5}',
    ]);
    cleanupItems.push(agent.cleanup);

    const { code, stderr } = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'claude', '--session', fixture.sessionId, '--project-root', fixture.projectDir],
      baseEnv(fixture, artifactsDir, agent.env()),
    );

    expect(code).toBe(0);
    expect(stderr).toContain('Accepted: 1');
    expect(stderr).toContain('Rejected: 0');

    const state = JSON.parse(
      await readFile(join(artifactsDir, fixture.sessionId, 'current-review-state.json'), 'utf8'),
    ) as ReviewState;
    expect(state.components[0]?.status).toBe('accepted');

    const count = await readFile(agent.countFile, 'utf8');
    expect(count).toBe('1');
  });

  it('persists rejected status when agent rejects the component', async () => {
    const { fixture, artifactsDir } = await setup([
      {
        name: 'HeroBannerGql',
        source: 'src/HeroBannerGql.tsx',
        framework: 'react',
        props: [{ name: 'id', type: 'string', required: true }],
        slots: [],
        extractionConfidence: 2,
        reviewReasons: [HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON],
        needsReview: true,
      },
    ]);

    const agent = await createScriptedAgent('claude', [
      '{"tool":"reject_component","name":"HeroBannerGql","reason":"data-fetch wrapper","confidence":5}',
    ]);
    cleanupItems.push(agent.cleanup);

    const { code, stderr } = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'claude', '--session', fixture.sessionId, '--project-root', fixture.projectDir],
      baseEnv(fixture, artifactsDir, agent.env()),
    );

    expect(code).toBe(0);
    expect(stderr).toContain('Accepted: 0');
    expect(stderr).toContain('Rejected: 1');

    const state = JSON.parse(
      await readFile(join(artifactsDir, fixture.sessionId, 'current-review-state.json'), 'utf8'),
    ) as ReviewState;
    expect(state.components[0]?.status).toBe('rejected');
  });

  it('makes exactly one agent call per component (single-pass)', async () => {
    const { fixture, artifactsDir } = await setup();

    const agent = await createScriptedAgent('claude', [
      '{"tool":"select_component","name":"Button","reason":"ui","confidence":5}',
      '{"tool":"select_component","name":"Card","reason":"ui","confidence":5}',
    ]);
    cleanupItems.push(agent.cleanup);

    await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'claude', '--session', fixture.sessionId, '--project-root', fixture.projectDir],
      baseEnv(fixture, artifactsDir, agent.env()),
    );

    const count = await readFile(agent.countFile, 'utf8');
    expect(Number(count)).toBe(2);
  });

  it('emits select_agent_decision events for decided components', async () => {
    const { fixture, artifactsDir } = await setup([
      {
        name: 'Button',
        source: 'src/Button.tsx',
        framework: 'react',
        props: [{ name: 'label', type: 'string', required: true }],
        slots: [],
      },
    ]);

    const agent = await createScriptedAgent('claude', [
      '{"tool":"select_component","name":"Button","reason":"ui","confidence":5}',
    ]);
    cleanupItems.push(agent.cleanup);

    const { code } = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'claude', '--session', fixture.sessionId, '--project-root', fixture.projectDir],
      baseEnv(fixture, artifactsDir, agent.env()),
    );

    expect(code).toBe(0);
    const events = (await readFile(join(artifactsDir, fixture.sessionId, 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as EventLine);

    const decisionEvent = events.find((e) => e.type === 'select_agent_decision');
    expect(decisionEvent).toBeDefined();
    expect(decisionEvent?.payload.status).toBe('accepted');
    expect(decisionEvent?.payload.component).toBe('Button');
  });
});

// ── Failure modes ────────────────────────────────────────────────────────────

describe('select-agent command — agent failure modes', () => {
  it('marks component as failed when agent produces no tool call', async () => {
    const { fixture, artifactsDir } = await setup([
      {
        name: 'Button',
        source: 'src/Button.tsx',
        framework: 'react',
        props: [{ name: 'label', type: 'string', required: true }],
        slots: [],
      },
    ]);

    const agent = await createScriptedAgent('claude', [
      'just some prose with no tool call json here',
    ]);
    cleanupItems.push(agent.cleanup);

    const { code, stderr } = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'claude', '--session', fixture.sessionId, '--project-root', fixture.projectDir],
      baseEnv(fixture, artifactsDir, agent.env()),
    );

    expect(code).toBe(0);
    expect(stderr).toContain('Failed');
  });

  it('marks step as failed when all components fail', async () => {
    const { fixture, artifactsDir } = await setup([
      {
        name: 'Button',
        source: 'src/Button.tsx',
        framework: 'react',
        props: [{ name: 'label', type: 'string', required: true }],
        slots: [],
      },
    ]);

    const badAgent = await mkdtemp(join(tmpdir(), 'bad-agent-'));
    const script = join(badAgent, 'claude');
    await writeFile(script, '#!/bin/sh\nexit 1');
    await chmod(script, '755');
    cleanupItems.push(() => rm(badAgent, { recursive: true, force: true }));

    const { code } = await runCliWithEnv(
      ['analyze', 'select-agent', '--agent', 'claude', '--session', fixture.sessionId, '--project-root', fixture.projectDir],
      {
        EDS_PIPELINE_DB_PATH: fixture.dbPath,
        EDS_REVIEW_ARTIFACTS_DIR: artifactsDir,
        NODE_NO_WARNINGS: '1',
        PATH: `${badAgent}:${process.env.PATH}`,
      },
    );

    expect(code).toBe(0);
  });
});

// ── selectionContext in prompt ────────────────────────────────────────────────

describe('select-agent command — selectionContext in prompt', () => {
  it('includes selectionContext in the prompt when project-root matches scanned files', async () => {
    const { fixture, artifactsDir } = await setup([
      {
        name: 'HeroBannerGql',
        source: 'src/components/HeroBannerGql.tsx',
        framework: 'react',
        props: [{ name: 'id', type: 'string', required: true }],
        slots: [],
        extractionConfidence: 2,
        reviewReasons: [HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON],
        needsReview: true,
      },
    ]);

    await mkdir(join(fixture.projectDir, 'src/components'), { recursive: true });
    await writeFile(
      join(fixture.projectDir, 'src/components/HeroBannerGql.tsx'),
      `import { HeroBanner } from './HeroBanner';
export function HeroBannerGql({ id }: { id: string }) {
  return <HeroBanner title={id} />;
}`,
      'utf8',
    );
    await writeFile(
      join(fixture.projectDir, 'src/components/HeroBanner.tsx'),
      `export function HeroBanner({ title }: { title: string }) {
  return <h1>{title}</h1>;
}`,
      'utf8',
    );

    fixture.addScannedFiles([join(fixture.projectDir, 'src/components/HeroBanner.tsx')]);

    const agent = await createScriptedAgent('claude', [
      '{"tool":"reject_component","name":"HeroBannerGql","reason":"data-fetch wrapper","confidence":5}',
    ]);
    cleanupItems.push(agent.cleanup);

    const { stdout, code } = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
        '--dry-run',
      ],
      {
        EDS_PIPELINE_DB_PATH: fixture.dbPath,
        EDS_REVIEW_ARTIFACTS_DIR: artifactsDir,
        NODE_NO_WARNINGS: '1',
        ...agent.env(),
      },
    );

    expect(code).toBe(0);
    expect(stdout).toContain('"selectionContext"');
    expect(stdout).toContain('"siblingFiles"');
  });
});
