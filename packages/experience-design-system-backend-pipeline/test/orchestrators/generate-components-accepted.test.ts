import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import * as sessionDb from '../../src/persistence/src/session/repositories/db.js';
import { getOrCreateSession, storeRawComponents } from '../../src/persistence/src/session/repositories/db.js';
import { runGenerateComponentsSession } from '../../src/orchestrators/run-generate-components-session/run-generate-components-session.js';

vi.mock('../../src/agents/invoker/create-local-cli-agent-invoker.js', () => ({
  createLocalCliAgentInvoker: () => ({}),
}));
vi.mock('../../src/orchestrators/run-generate-components-session/helpers/resolve-generate-prompt.js', () => ({
  resolveGeneratePrompt: async () => ({}),
}));
vi.mock('../../src/persistence/src/session/helpers/cache-keys.js', async (original) => ({
  ...(await original<object>()),
  hashPromptForSkill: async () => 'example-prompt',
}));
vi.mock('../../src/orchestrators/run-generate-components-session/helpers/run-one-generate-component.js', () => ({
  runOneGenerateComponent: async (_context: unknown, component: { name: string }) => ({
    componentName: component.name,
    failed: false,
    renamedSlotsCount: 0,
  }),
}));

describe('which components generation runs for', () => {
  let db: DatabaseSync;
  let sessionId: string;

  beforeEach(() => {
    db = sessionDb.openPipelineDb(':memory:');
    vi.spyOn(sessionDb, 'openPipelineDb').mockReturnValue(db);
    vi.spyOn(db, 'close').mockImplementation(() => {});
    sessionId = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' }).sessionId;
    storeRawComponents(
      db,
      sessionId,
      ['Button', 'Card', 'Helper'].map((name) => ({ name, source: name, framework: 'react', props: [], slots: [] })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  const generate = (acceptedNames: string[]) =>
    runGenerateComponentsSession({ sessionId, acceptedNames, agent: 'codex', promptOverrides: [], noCache: true });

  it('generates exactly the accepted components', async () => {
    const response = await generate(['Card', 'Button']);
    expect(response.results.map((result) => result.componentName)).toEqual(['Button', 'Card']);
    expect(response.emptySession).toBe(false);
  });

  it('generates nothing when nothing was accepted', async () => {
    const response = await generate([]);
    expect(response.results).toEqual([]);
    expect(response.emptySession).toBe(true);
  });

  it('generates nothing when none of the accepted components are in the session', async () => {
    const response = await generate(['Missing']);
    expect(response.results).toEqual([]);
    expect(response.emptySession).toBe(true);
  });
});
