import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOrCreateSession,
  loadRawComponents,
  openPipelineDb,
  storeRawComponents,
} from '@contentful/experience-design-system-backend-pipeline';

// The agent itself is scripted: it prints the tool calls a real agent would, and records the prompt it was given.
const agent = vi.hoisted(() => ({
  invocations: [] as Array<{ prompt: string; signal?: AbortSignal }>,
  result: { stdout: '', stderr: '', exitCode: 0, timedOut: false } as {
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
  },
  waiter: undefined as Promise<{ stdout: string; stderr: string; exitCode: number; timedOut: boolean }> | undefined,
}));

vi.mock('@contentful/experience-design-system-backend-pipeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@contentful/experience-design-system-backend-pipeline')>();
  return {
    ...actual,
    createLocalCliAgentInvoker: () => ({
      invoke: async (options: { prompt: string; signal?: AbortSignal }) => {
        agent.invocations.push({ prompt: options.prompt, signal: options.signal });
        return (await agent.waiter) ?? agent.result;
      },
    }),
  };
});
vi.mock('../../../src/tui/import/steps/06-extraction/find-skill-path.js', () => ({
  findSkillPath: (fileName: string) =>
    new URL(
      `../../../../experience-design-system-backend-pipeline/src/agents/skills/selection/${fileName}`,
      import.meta.url,
    ).pathname,
}));

const debug = vi.hoisted(() => ({ record: vi.fn(async () => {}) }));
vi.mock('../../../src/tui/debug-store.js', () => ({ recordDebugEvent: debug.record }));

import { runSelection } from '../../../src/tui/import/steps/06-extraction/selection.js';

const component = (name: string) => ({
  name,
  source: `src/${name}.tsx`,
  framework: 'react' as const,
  props: [{ name: 'title', type: 'string', required: false, category: 'content' as const }],
  slots: [],
});

const lines = (...calls: Array<Record<string, unknown>>): string =>
  calls.map((call) => JSON.stringify(call)).join('\n');

describe('runSelection', () => {
  let dir: string;
  let previousDbPath: string | undefined;
  let sessionId: string;

  const seed = (names: string[]): void => {
    const db = openPipelineDb();
    try {
      sessionId = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' }).sessionId;
      storeRawComponents(db, sessionId, names.map(component));
    } finally {
      db.close();
    }
  };

  const statuses = (): Record<string, { status: string; reason: string | null }> => {
    const db = openPipelineDb();
    try {
      const rows = db
        .prepare('SELECT name, status, reject_reason FROM raw_components WHERE session_id = ?')
        .all(sessionId) as Array<{ name: string; status: string; reject_reason: string | null }>;
      return Object.fromEntries(rows.map((row) => [row.name, { status: row.status, reason: row.reject_reason }]));
    } finally {
      db.close();
    }
  };

  const options = (overrides: Partial<Parameters<typeof runSelection>[0]> = {}) => ({
    sessionId,
    agent: 'claude' as const,
    noCache: false,
    ...overrides,
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'selection-'));
    previousDbPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = join(dir, 'pipeline.db');
    agent.invocations.length = 0;
    debug.record.mockClear();
    agent.result = { stdout: '', stderr: '', exitCode: 0, timedOut: false };
  });

  afterEach(async () => {
    if (previousDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  });

  it('records what the agent accepted and rejected, with the reason for a rejection', async () => {
    seed(['Card', 'Hero']);
    agent.result.stdout = lines(
      { tool: 'select_component', name: 'Card' },
      { tool: 'reject_component', name: 'Hero', reason: 'internal layout helper' },
    );

    await runSelection(options());

    expect(statuses()).toEqual({
      Card: { status: 'accepted', reason: null },
      Hero: { status: 'rejected', reason: 'internal layout helper' },
    });
  });

  it('puts every component in the prompt', async () => {
    seed(['Card', 'Hero']);
    agent.result.stdout = lines({ tool: 'select_component', name: 'Card' }, { tool: 'select_component', name: 'Hero' });

    await runSelection(options());

    expect(agent.invocations).toHaveLength(1);
    expect(agent.invocations[0]?.prompt).toContain('Card');
    expect(agent.invocations[0]?.prompt).toContain('Hero');
  });

  it('derives advisory buckets from saved provenance and strips it from raw agent data', async () => {
    seed(['Field']);
    const db = openPipelineDb();
    try {
      storeRawComponents(db, sessionId, [
        {
          ...component('Field'),
          props: [
            { name: 'name', type: 'string', required: false, domAttribute: true },
            { name: 'icon', type: 'string', required: false, domAttribute: false },
            { name: 'label', type: 'string', required: true },
          ],
        },
      ]);
    } finally {
      db.close();
    }
    agent.result.stdout = lines({ tool: 'select_component', name: 'Field' });
    await runSelection(options({ noCache: true, promptText: 'Select visible UI.' }));
    const prompt = agent.invocations[0]!.prompt;
    expect(prompt).not.toContain('"domAttribute"');
    const raw = prompt.match(/Raw component data \(JSON\):\n```json\n([\s\S]*?)\n```/);
    expect(JSON.parse(raw![1]!)[0].props).toEqual([
      { name: 'name', type: 'string', required: false },
      { name: 'icon', type: 'string', required: false },
      { name: 'label', type: 'string', required: true },
    ]);
    const advisory = prompt.match(/Deterministic prop buckets[^\n]*:\n```json\n([\s\S]*?)\n```/);
    expect(advisory).not.toBeNull();
    expect(JSON.parse(advisory![1]!)).toEqual([
      {
        component: 'Field',
        source: 'src/Field.tsx',
        customPropNames: ['icon', 'label'],
        domPassthroughPropNames: ['name'],
        otherPropNames: [],
      },
    ]);
    expect(debug.record).toHaveBeenCalledWith('prop-buckets.select', {
      sessionId,
      ...JSON.parse(advisory![1]!)[0],
    });
    expect(debug.record).toHaveBeenCalledTimes(1);
    const saved = openPipelineDb();
    try {
      expect(loadRawComponents(saved, sessionId)[0]?.props[0]?.domAttribute).toBe(true);
    } finally {
      saved.close();
    }
  });

  it('leaves a component alone when the agent says nothing about it', async () => {
    seed(['Card', 'Hero']);
    const before = statuses();
    agent.result.stdout = lines({ tool: 'select_component', name: 'Card' });

    await runSelection(options());

    expect(statuses().Card?.status).toBe('accepted');
    expect(statuses().Hero).toEqual(before.Hero);
  });

  it('does nothing when the session has no components', async () => {
    seed([]);
    await runSelection(options());
    expect(agent.invocations).toHaveLength(0);
    expect(debug.record).not.toHaveBeenCalled();
  });

  it('does not ask the agent again for components it already decided', async () => {
    seed(['Card', 'Hero']);
    agent.result.stdout = lines(
      { tool: 'select_component', name: 'Card' },
      { tool: 'reject_component', name: 'Hero', reason: 'helper' },
    );
    await runSelection(options());
    expect(agent.invocations).toHaveLength(1);

    const second = openPipelineDb();
    second
      .prepare("UPDATE raw_components SET status = 'extracted', reject_reason = NULL WHERE session_id = ?")
      .run(sessionId);
    second.close();

    await runSelection(options());

    expect(agent.invocations).toHaveLength(1);
    expect(statuses()).toEqual({
      Card: { status: 'accepted', reason: null },
      Hero: { status: 'rejected', reason: 'helper' },
    });
  });

  it('only asks the agent about the components it has not decided yet', async () => {
    seed(['Card']);
    agent.result.stdout = lines({ tool: 'select_component', name: 'Card' });
    await runSelection(options());

    const db = openPipelineDb();
    storeRawComponents(db, sessionId, [component('Card'), component('Hero')]);
    db.close();
    agent.result.stdout = lines({ tool: 'reject_component', name: 'Hero', reason: 'new helper' });

    await runSelection(options());

    expect(agent.invocations).toHaveLength(2);
    expect(agent.invocations[1]?.prompt).toContain('Hero');
    expect(agent.invocations[1]?.prompt).not.toContain('src/Card.tsx');
  });

  it('asks the agent about everything again with the cache off', async () => {
    seed(['Card']);
    agent.result.stdout = lines({ tool: 'select_component', name: 'Card' });
    await runSelection(options());
    await runSelection(options({ noCache: true }));
    expect(agent.invocations).toHaveLength(2);
  });

  it('asks again when the agent or model changes, since the cached answer was not made by it', async () => {
    seed(['Card']);
    agent.result.stdout = lines({ tool: 'select_component', name: 'Card' });
    await runSelection(options());
    await runSelection(options({ agent: 'codex' }));
    await runSelection(options({ model: 'other' }));
    expect(agent.invocations).toHaveLength(3);
  });

  it('asks again when the prompt changes', async () => {
    seed(['Card']);
    agent.result.stdout = lines({ tool: 'select_component', name: 'Card' });
    await runSelection(options({ promptText: 'first prompt' }));
    await runSelection(options({ promptText: 'second prompt' }));
    expect(agent.invocations).toHaveLength(2);
  });

  it('fails without touching the database when the agent times out', async () => {
    seed(['Card']);
    const before = statuses();
    agent.result = { stdout: '', stderr: '', exitCode: 0, timedOut: true };

    await expect(runSelection(options())).rejects.toThrow('selection agent timed out');

    expect(statuses()).toEqual(before);
  });

  it('fails without touching the database when the agent exits with an error', async () => {
    seed(['Card']);
    const before = statuses();
    agent.result = { stdout: '', stderr: 'boom', exitCode: 2, timedOut: false };

    await expect(runSelection(options())).rejects.toThrow('selection agent exited with code 2');

    expect(statuses()).toEqual(before);
  });

  it('does not parse or persist valid selection output after cancellation', async () => {
    seed(['Card']);
    const before = statuses();
    const controller = new AbortController();
    let finishInvocation!: (result: typeof agent.result) => void;
    agent.result = {
      stdout: lines({ tool: 'select_component', name: 'Card' }),
      stderr: '',
      exitCode: 0,
      timedOut: false,
    };
    agent.waiter = new Promise((resolve) => (finishInvocation = resolve));

    const running = runSelection({
      ...options(),
      promptText: 'selection test prompt',
      noCache: true,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(agent.invocations).toHaveLength(1));
    controller.abort();
    finishInvocation(agent.result);

    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(agent.invocations[0]?.signal).toBe(controller.signal);
    expect(statuses()).toEqual(before);
    agent.waiter = undefined;
  });

  it('writes nothing, and caches nothing, when the update fails part way through', async () => {
    seed(['Card', 'Hero']);
    agent.result.stdout = lines({ tool: 'select_component', name: 'Card' }, { tool: 'select_component', name: 'Hero' });
    const db = openPipelineDb();
    db.exec(
      `CREATE TRIGGER fail_on_hero BEFORE UPDATE ON raw_components WHEN NEW.name = 'Hero' BEGIN SELECT RAISE(ABORT, 'forced failure'); END`,
    );
    db.close();
    const before = statuses();

    await expect(runSelection(options())).rejects.toThrow(/forced failure/);

    expect(statuses()).toEqual(before);
    const check = openPipelineDb();
    const cached = check.prepare('SELECT COUNT(*) AS n FROM select_cache').get() as { n: number };
    check.close();
    expect(cached.n).toBe(0);
  });

  it('can read the components it was given back out of the session', () => {
    seed(['Card']);
    const db = openPipelineDb();
    const names = loadRawComponents(db, sessionId).map((c) => c.name);
    db.close();
    expect(names).toEqual(['Card']);
  });
});
