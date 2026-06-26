import { describe, it, expect, afterEach } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCliWithEnv } from '../../helpers/cli-runner.js';
import { createTestFixture, type TestFixture } from '../../helpers/fixtures.js';
import { HIGH_CONFIDENCE_DATA_FETCH_WRAPPER_REASON } from '../../../src/analyze/extract/source-inspection.js';
import { DEFAULT_CONCURRENCY, DEFAULT_BATCH_SIZE } from '../../../src/analyze/select-agent/command.js';

describe('select-agent constants', () => {
  it('DEFAULT_CONCURRENCY is 10', () => {
    expect(DEFAULT_CONCURRENCY).toBe(10);
  });
  it('DEFAULT_BATCH_SIZE is 5', () => {
    expect(DEFAULT_BATCH_SIZE).toBe(5);
  });
});

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
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
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
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
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

  it('batches multiple components into a single agent invocation', async () => {
    const { fixture, artifactsDir } = await setup();

    // Two-component default fixture; one batch (size 5) emits both tool calls.
    const agent = await createScriptedAgent('claude', [
      [
        '{"tool":"select_component","name":"Button","reason":"ui","confidence":5}',
        '{"tool":"select_component","name":"Card","reason":"ui","confidence":5}',
      ].join('\n'),
    ]);
    cleanupItems.push(agent.cleanup);

    await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
      {
        ...baseEnv(fixture, artifactsDir, agent.env()),
        EDS_GENERATE_CONCURRENCY: '1',
      },
    );

    const count = await readFile(agent.countFile, 'utf8');
    expect(Number(count)).toBe(1);
  });

  it('respects EDS_SELECT_BATCH_SIZE: 7 components with batch=3 → 3 invocations', async () => {
    const components = Array.from({ length: 7 }, (_, i) => ({
      name: `Comp${i}`,
      source: `src/Comp${i}.tsx`,
      framework: 'react' as const,
      props: [{ name: 'label', type: 'string', required: true }],
      slots: [],
    }));
    const { fixture, artifactsDir } = await setup(components);

    // Three batches: [0,1,2], [3,4,5], [6]. Pre-stage tool calls for each batch.
    const agent = await createScriptedAgent('claude', [
      ['Comp0', 'Comp1', 'Comp2']
        .map((n) => `{"tool":"select_component","name":"${n}","reason":"ui","confidence":5}`)
        .join('\n'),
      ['Comp3', 'Comp4', 'Comp5']
        .map((n) => `{"tool":"select_component","name":"${n}","reason":"ui","confidence":5}`)
        .join('\n'),
      '{"tool":"select_component","name":"Comp6","reason":"ui","confidence":5}',
    ]);
    cleanupItems.push(agent.cleanup);

    await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
      {
        ...baseEnv(fixture, artifactsDir, agent.env()),
        EDS_GENERATE_CONCURRENCY: '1',
        EDS_SELECT_BATCH_SIZE: '3',
      },
    );

    const count = await readFile(agent.countFile, 'utf8');
    expect(Number(count)).toBe(3);
  });

  it('default batch size of 5: 12 components → 3 invocations', async () => {
    const components = Array.from({ length: 12 }, (_, i) => ({
      name: `Comp${i}`,
      source: `src/Comp${i}.tsx`,
      framework: 'react' as const,
      props: [{ name: 'label', type: 'string', required: true }],
      slots: [],
    }));
    const { fixture, artifactsDir } = await setup(components);

    const batch1 = Array.from({ length: 5 }, (_, i) => `Comp${i}`);
    const batch2 = Array.from({ length: 5 }, (_, i) => `Comp${i + 5}`);
    const batch3 = ['Comp10', 'Comp11'];
    const agent = await createScriptedAgent('claude', [
      batch1.map((n) => `{"tool":"select_component","name":"${n}","reason":"ui","confidence":5}`).join('\n'),
      batch2.map((n) => `{"tool":"select_component","name":"${n}","reason":"ui","confidence":5}`).join('\n'),
      batch3.map((n) => `{"tool":"select_component","name":"${n}","reason":"ui","confidence":5}`).join('\n'),
    ]);
    cleanupItems.push(agent.cleanup);

    await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
      {
        ...baseEnv(fixture, artifactsDir, agent.env()),
        EDS_GENERATE_CONCURRENCY: '1',
      },
    );

    const count = await readFile(agent.countFile, 'utf8');
    expect(Number(count)).toBe(3);
  });

  it('emits one progress=select-agent line per component in a batched run', async () => {
    const components = Array.from({ length: 5 }, (_, i) => ({
      name: `Comp${i}`,
      source: `src/Comp${i}.tsx`,
      framework: 'react' as const,
      props: [{ name: 'label', type: 'string', required: true }],
      slots: [],
    }));
    const { fixture, artifactsDir } = await setup(components);

    // Single batch — all 5 in one invocation, tool calls in REVERSE order to
    // verify the progress lines emit in input order, not response order.
    const agent = await createScriptedAgent('claude', [
      ['Comp4', 'Comp3', 'Comp2', 'Comp1', 'Comp0']
        .map((n) => `{"tool":"select_component","name":"${n}","reason":"ui","confidence":5}`)
        .join('\n'),
    ]);
    cleanupItems.push(agent.cleanup);

    const { stderr } = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
      baseEnv(fixture, artifactsDir, agent.env()),
    );

    const progressLines = stderr.split('\n').filter((l) => l.startsWith('progress=select-agent:'));
    expect(progressLines).toHaveLength(5);
    // Input-order N/M and component-name pairing.
    for (let i = 0; i < 5; i++) {
      expect(progressLines[i]).toContain(`:${i + 1}/5:accepted:Comp${i}:`);
    }
  });

  it('out-of-order tool calls map to components by name', async () => {
    const components = Array.from({ length: 3 }, (_, i) => ({
      name: `Comp${i}`,
      source: `src/Comp${i}.tsx`,
      framework: 'react' as const,
      props: [{ name: 'label', type: 'string', required: true }],
      slots: [],
    }));
    const { fixture, artifactsDir } = await setup(components);

    const agent = await createScriptedAgent('claude', [
      [
        '{"tool":"reject_component","name":"Comp2","reason":"r2","confidence":5}',
        '{"tool":"select_component","name":"Comp0","reason":"r0","confidence":5}',
        '{"tool":"reject_component","name":"Comp1","reason":"r1","confidence":5}',
      ].join('\n'),
    ]);
    cleanupItems.push(agent.cleanup);

    const { code } = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
      baseEnv(fixture, artifactsDir, agent.env()),
    );
    expect(code).toBe(0);

    const state = JSON.parse(
      await readFile(join(artifactsDir, fixture.sessionId, 'current-review-state.json'), 'utf8'),
    ) as ReviewState;
    const byName = Object.fromEntries(state.components.map((c) => [c.name, c.status]));
    expect(byName['Comp0']).toBe('accepted');
    expect(byName['Comp1']).toBe('rejected');
    expect(byName['Comp2']).toBe('rejected');
  });

  it('emits progress=select-agent:N/M:failed:<name>:no-tool-call-from-agent for batch-skipped components (default)', async () => {
    const components = Array.from({ length: 3 }, (_, i) => ({
      name: `Comp${i}`,
      source: `src/Comp${i}.tsx`,
      framework: 'react' as const,
      props: [{ name: 'label', type: 'string', required: true }],
      slots: [],
    }));
    const { fixture, artifactsDir } = await setup(components);

    // Agent omits Comp1.
    const agent = await createScriptedAgent('claude', [
      [
        '{"tool":"select_component","name":"Comp0","reason":"ok","confidence":5}',
        '{"tool":"select_component","name":"Comp2","reason":"ok","confidence":5}',
      ].join('\n'),
    ]);
    cleanupItems.push(agent.cleanup);

    const { stderr } = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
      baseEnv(fixture, artifactsDir, agent.env()),
    );

    const failedLine = stderr
      .split('\n')
      .find((l) => l.startsWith('progress=select-agent:') && l.includes(':failed:'));
    expect(failedLine).toBeDefined();
    expect(failedLine).toContain(':failed:Comp1:');
    expect(failedLine).toContain(encodeURIComponent('no-tool-call-from-agent'));
  });

  it('--reject-on-missing synthesizes rejections for batch-skipped components', async () => {
    const components = Array.from({ length: 3 }, (_, i) => ({
      name: `Comp${i}`,
      source: `src/Comp${i}.tsx`,
      framework: 'react' as const,
      props: [{ name: 'label', type: 'string', required: true }],
      slots: [],
    }));
    const { fixture, artifactsDir } = await setup(components);

    // Agent omits Comp1 and Comp2 entirely (operator's audit prompt rejected
    // those by leaving them out). --reject-on-missing flips the no-tool-call
    // branch from "failed" to "rejected".
    const agent = await createScriptedAgent('claude', [
      '{"tool":"select_component","name":"Comp0","reason":"ok","confidence":5}',
    ]);
    cleanupItems.push(agent.cleanup);

    const { code, stderr } = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
        '--reject-on-missing',
      ],
      baseEnv(fixture, artifactsDir, agent.env()),
    );
    expect(code).toBe(0);
    expect(stderr).toContain('Accepted: 1');
    expect(stderr).toContain('Rejected: 2');
    expect(stderr).not.toContain('Failed (');

    const state = JSON.parse(
      await readFile(join(artifactsDir, fixture.sessionId, 'current-review-state.json'), 'utf8'),
    ) as ReviewState;
    const byName = Object.fromEntries(state.components.map((cmp) => [cmp.name, cmp.status]));
    expect(byName['Comp0']).toBe('accepted');
    expect(byName['Comp1']).toBe('rejected');
    expect(byName['Comp2']).toBe('rejected');
  });

  it('--reject-on-missing emits progress=rejected lines (not failed) for omitted components', async () => {
    const components = Array.from({ length: 3 }, (_, i) => ({
      name: `Comp${i}`,
      source: `src/Comp${i}.tsx`,
      framework: 'react' as const,
      props: [{ name: 'label', type: 'string', required: true }],
      slots: [],
    }));
    const { fixture, artifactsDir } = await setup(components);

    const agent = await createScriptedAgent('claude', [
      '{"tool":"select_component","name":"Comp0","reason":"ok","confidence":5}',
    ]);
    cleanupItems.push(agent.cleanup);

    const { stderr } = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
        '--reject-on-missing',
      ],
      baseEnv(fixture, artifactsDir, agent.env()),
    );

    const progressLines = stderr.split('\n').filter((l) => l.startsWith('progress=select-agent:'));
    const rejectedNoToolCallLines = progressLines.filter(
      (l) => l.includes(':rejected:') && l.includes(encodeURIComponent('no-tool-call-from-agent')),
    );
    expect(rejectedNoToolCallLines).toHaveLength(2);
    const failedLines = progressLines.filter((l) => l.includes(':failed:'));
    expect(failedLines).toHaveLength(0);
  });

  it('missing tool call in batch marks only that component failed', async () => {
    const components = Array.from({ length: 3 }, (_, i) => ({
      name: `Comp${i}`,
      source: `src/Comp${i}.tsx`,
      framework: 'react' as const,
      props: [{ name: 'label', type: 'string', required: true }],
      slots: [],
    }));
    const { fixture, artifactsDir } = await setup(components);

    // Agent omits Comp1 from its response.
    const agent = await createScriptedAgent('claude', [
      [
        '{"tool":"select_component","name":"Comp0","reason":"ok","confidence":5}',
        '{"tool":"select_component","name":"Comp2","reason":"ok","confidence":5}',
      ].join('\n'),
    ]);
    cleanupItems.push(agent.cleanup);

    const { code, stderr } = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
      baseEnv(fixture, artifactsDir, agent.env()),
    );
    expect(code).toBe(0);
    expect(stderr).toContain('Failed (1/3)');
    expect(stderr).toContain('Comp1');
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
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
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

    const agent = await createScriptedAgent('claude', ['just some prose with no tool call json here']);
    cleanupItems.push(agent.cleanup);

    const { code, stderr } = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
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
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
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

// ── Feature 3: reject_reason persistence ─────────────────────────────────────

describe('select-agent command — reject_reason persistence (Feature 3)', () => {
  it('persists LLM reason to raw_components.reject_reason on rejection', async () => {
    const { fixture, artifactsDir } = await setup([
      {
        name: 'BadgeIcon',
        source: 'src/BadgeIcon.tsx',
        framework: 'react',
        props: [{ name: 'icon', type: 'string', required: true }],
        slots: [],
      },
    ]);

    const agent = await createScriptedAgent('claude', [
      '{"tool":"reject_component","name":"BadgeIcon","reason":"low semantic value","confidence":5}',
    ]);
    cleanupItems.push(agent.cleanup);

    const { code } = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
      baseEnv(fixture, artifactsDir, agent.env()),
    );
    expect(code).toBe(0);

    const { openPipelineDb } = await import('../../../src/session/db.js');
    const db = openPipelineDb(fixture.dbPath);
    try {
      const row = db
        .prepare('SELECT name, status, reject_reason FROM raw_components WHERE session_id = ? AND name = ?')
        .get(fixture.sessionId, 'BadgeIcon') as { name: string; status: string; reject_reason: string | null };
      expect(row.status).toBe('rejected');
      expect(row.reject_reason).toBe('low semantic value');
    } finally {
      db.close();
    }
  });

  it('clears reject_reason to NULL on accepted components', async () => {
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
      '{"tool":"select_component","name":"Button","reason":"primary UI","confidence":5}',
    ]);
    cleanupItems.push(agent.cleanup);

    const { code } = await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
      baseEnv(fixture, artifactsDir, agent.env()),
    );
    expect(code).toBe(0);

    const { openPipelineDb } = await import('../../../src/session/db.js');
    const db = openPipelineDb(fixture.dbPath);
    try {
      const row = db
        .prepare('SELECT status, reject_reason FROM raw_components WHERE session_id = ? AND name = ?')
        .get(fixture.sessionId, 'Button') as { status: string; reject_reason: string | null };
      expect(row.status).toBe('accepted');
      expect(row.reject_reason).toBeNull();
    } finally {
      db.close();
    }
  });

  it('flips reject_reason to NULL when re-running flips a rejected component to accepted', async () => {
    const { fixture, artifactsDir } = await setup([
      {
        name: 'Button',
        source: 'src/Button.tsx',
        framework: 'react',
        props: [{ name: 'label', type: 'string', required: true }],
        slots: [],
      },
    ]);

    const rejectAgent = await createScriptedAgent('claude', [
      '{"tool":"reject_component","name":"Button","reason":"too generic","confidence":5}',
    ]);
    cleanupItems.push(rejectAgent.cleanup);
    await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
      ],
      baseEnv(fixture, artifactsDir, rejectAgent.env()),
    );

    const { openPipelineDb } = await import('../../../src/session/db.js');
    {
      const db = openPipelineDb(fixture.dbPath);
      try {
        const row = db
          .prepare('SELECT reject_reason FROM raw_components WHERE session_id = ? AND name = ?')
          .get(fixture.sessionId, 'Button') as { reject_reason: string | null };
        expect(row.reject_reason).toBe('too generic');
      } finally {
        db.close();
      }
    }

    const acceptAgent = await createScriptedAgent('claude', [
      '{"tool":"select_component","name":"Button","reason":"primary UI","confidence":5}',
    ]);
    cleanupItems.push(acceptAgent.cleanup);
    // --no-cache so the second LLM run is not short-circuited by the select cache
    // from the first run (which would replay the prior "rejected" decision).
    await runCliWithEnv(
      [
        'analyze',
        'select-agent',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--project-root',
        fixture.projectDir,
        '--no-cache',
      ],
      baseEnv(fixture, artifactsDir, acceptAgent.env()),
    );

    const db = openPipelineDb(fixture.dbPath);
    try {
      const row = db
        .prepare('SELECT status, reject_reason FROM raw_components WHERE session_id = ? AND name = ?')
        .get(fixture.sessionId, 'Button') as { status: string; reject_reason: string | null };
      expect(row.status).toBe('accepted');
      expect(row.reject_reason).toBeNull();
    } finally {
      db.close();
    }
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
