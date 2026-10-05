import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { runSelectionAgent } from '../../../src/import/tui/run-selection-agent.js';
import {
  baseEnv,
  createSessionFixture,
  createScriptedAgent,
  SAMPLE_TWO_COMPONENTS,
  selectAllResponderSource,
  type SessionFixture,
  type ScriptedAgent,
} from '../../integration/scripted-agent-harness.js';

const ENV_KEYS = ['PATH', 'EDS_PIPELINE_DB_PATH', 'EDS_REVIEW_ARTIFACTS_DIR'] as const;

let savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let fixture: SessionFixture;
let agent: ScriptedAgent;

async function arrange(responderSource: string): Promise<void> {
  fixture = await createSessionFixture(SAMPLE_TWO_COMPONENTS);
  agent = await createScriptedAgent(responderSource);
  const env = baseEnv(fixture, agent);
  for (const key of ENV_KEYS) process.env[key] = env[key];
}

function readDecisions(): Array<{ name: string; status: string; reject_reason: string | null }> {
  const db = new DatabaseSync(fixture.dbPath);
  try {
    return db
      .prepare('SELECT name, status, reject_reason FROM raw_components WHERE session_id = ? ORDER BY name')
      .all(fixture.sessionId) as Array<{ name: string; status: string; reject_reason: string | null }>;
  } finally {
    db.close();
  }
}

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await fixture?.cleanup();
  await agent?.cleanup();
});

describe('runSelectionAgent', () => {
  it('invokes the selection agent on every run, including repeat runs over unchanged components', async () => {
    await arrange(selectAllResponderSource('accept'));

    await runSelectionAgent({ sessionId: fixture.sessionId, agent: 'claude' });
    await runSelectionAgent({ sessionId: fixture.sessionId, agent: 'claude' });

    expect(await agent.callCount()).toBe(2);
    expect(await agent.callLog()).toHaveLength(2);
  });

  it('sends every component to the agent on a repeat run', async () => {
    await arrange(selectAllResponderSource('accept'));

    await runSelectionAgent({ sessionId: fixture.sessionId, agent: 'claude' });
    await runSelectionAgent({ sessionId: fixture.sessionId, agent: 'claude' });

    const [, second] = await agent.callLog();
    expect([...second!.componentNames].sort()).toEqual(['Button', 'Card']);
  });

  it('gives the selection prompt deterministic prop buckets without the extraction provenance flag', async () => {
    await arrange(selectAllResponderSource('accept'));

    await runSelectionAgent({ sessionId: fixture.sessionId, agent: 'claude' });

    const [call] = await agent.callLog();
    expect(call!.prompt).toContain('Deterministic prop buckets (advisory evidence only');
    expect(call!.prompt).toContain('customPropNames');
    expect(call!.prompt).not.toContain('domAttribute');
  });

  it('records accept and reject decisions with the rejection reason', async () => {
    await arrange(selectAllResponderSource('accept', { Card: 'reject' }));

    await runSelectionAgent({ sessionId: fixture.sessionId, agent: 'claude' });

    expect(readDecisions()).toEqual([
      { name: 'Button', status: 'accepted', reject_reason: null },
      { name: 'Card', status: 'rejected', reject_reason: 'harness-reject' },
    ]);
  });

  it('leaves components the agent did not decide on untouched', async () => {
    await arrange(
      `function(inv) { return JSON.stringify({ tool: 'select_component', name: 'Button', reason: 'ok', confidence: 5 }) + '\\n'; }`,
    );

    await runSelectionAgent({ sessionId: fixture.sessionId, agent: 'claude' });

    expect(readDecisions().map((row) => [row.name, row.status])).toEqual([
      ['Button', 'accepted'],
      ['Card', 'extracted'],
    ]);
  });

  it('fails without touching decisions when the agent exits non-zero', async () => {
    await arrange(`function(inv) { process.exit(3); }`);

    await expect(runSelectionAgent({ sessionId: fixture.sessionId, agent: 'claude' })).rejects.toThrow(
      'selection agent exited with code 3',
    );
    expect(readDecisions().map((row) => row.status)).toEqual(['extracted', 'extracted']);
  });
});
