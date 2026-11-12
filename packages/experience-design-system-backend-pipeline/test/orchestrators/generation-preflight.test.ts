import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { buildCDF, validateCDF } from '@contentful/experience-design-system-types';
import {
  getOrCreateSession,
  loadCDFComponents,
  loadRawComponents,
  openPipelineDb,
  storeRawComponents,
} from '../../src/persistence/src/session/repositories/db.js';
import { runOneGenerateComponent } from '../../src/orchestrators/run-generate-components-session/helpers/run-one-generate-component.js';
import type { AgentInvoker } from '../../src/agents/types/invoker.js';
import type { GenerateComponentsProgress } from '../../src/orchestrators/run-generate-components-session/types.js';

vi.mock('../../src/agents/prompts/build-prompt.js', () => ({ buildPrompt: async () => 'Generate Card' }));

const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.useRealTimers();
});

const propCall = (overrides = {}) => ({
  tool: 'classify_prop',
  prop: 'label',
  cdf_type: 'string',
  cdf_category: 'content',
  ...overrides,
});
const output = (...calls: object[]) => ({
  exitCode: 0,
  stdout: calls.map((call) => JSON.stringify(call)).join('\n'),
  stderr: '',
  timedOut: false,
});

function setup(outputs: ReturnType<typeof output>[]) {
  const db = openPipelineDb(':memory:');
  databases.push(db);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, [
    {
      name: 'Card',
      source: 'src/Card.tsx',
      framework: 'react',
      props: [{ name: 'label', type: 'string', required: false }],
      slots: [{ name: 'children', isDefault: true }],
    },
  ]);
  const component = loadRawComponents(db, sessionId)[0]!;
  const invoke = vi.fn<AgentInvoker['invoke']>();
  for (const result of outputs) invoke.mockResolvedValueOnce(result);
  const events: GenerateComponentsProgress[] = [];
  const run = () =>
    runOneGenerateComponent(
      {
        db,
        sessionId,
        invoker: { invoke, checkAuth: async () => 'ok' },
        agent: 'codex',
        model: undefined,
        tokensInline: undefined,
        tokenMapInline: undefined,
        verbose: false,
        noCache: false,
        skillPathOverride: undefined,
        skillContentOverride: undefined,
        promptHash: 'example-prompt',
        existingContentfulEntities: undefined,
        existingTokensInline: undefined,
        precomputedCachedNames: new Set(),
        allowedComponentNames: new Set(['Card']),
        onProgress: (event) => events.push(event),
      },
      component,
      0,
      1,
    );
  return { db, sessionId, invoke, events, run };
}

describe('generation agent preflight', () => {
  it('rolls back an invalid CDF and immediately regenerates with validation feedback', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { db, sessionId, invoke, events, run } = setup([
      output(propCall({ token_kind: '', description: 'Rejected description', default: 'Rejected default' })),
      output(propCall()),
    ]);
    const result = await run();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]![0].prompt).toContain('Generation preflight');
    expect(invoke.mock.calls[1]![0].prompt).toContain('$token.kind');
    expect(result.failed).toBe(false);
    const document = buildCDF(loadCDFComponents(db, sessionId), []);
    expect(validateCDF(document).valid).toBe(true);
    expect(document).toHaveProperty('Card.$properties.label', { $type: 'string', $category: 'content' });
    expect(events.filter((event) => event.kind === 'component:completed')).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails after the bounded retries without persisting or caching either invalid attempt', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const invalid = output(propCall({ token_kind: '' }));
    const { db, sessionId, invoke, events, run } = setup([invalid, invalid]);
    const result = await run();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.failed).toBe(true);
    expect(result.failureKind).toBe('preflight');
    expect(result.error).toContain('$token.kind');
    expect(loadCDFComponents(db, sessionId)).toEqual([]);
    expect(db.prepare('SELECT * FROM generation_cache').all()).toEqual([]);
    expect(db.prepare('SELECT cdf_type FROM raw_props').get()).toEqual({ cdf_type: null });
    expect(events.some((event) => event.kind === 'component:completed')).toBe(false);
  });

  it('regenerates when an invalid classification was skipped beside valid tool calls', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { invoke, run } = setup([
      output({ tool: 'classify_component', description: 'Card' }, propCall({ cdf_type: 'impossible' })),
      output(propCall()),
    ]);
    expect((await run()).failed).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]![0].prompt).toContain('invalid cdf_type');
  });

  it.each([
    { tool: 'classify_slot', slot: 'invented' },
    propCall({ prop: 'invented' }),
    { tool: 'classify_slot', slot: 'children', allowed_components: ['MissingComponent'] },
  ])('regenerates invented references instead of dropping them: %j', async (call) => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { invoke, run } = setup([output(propCall(), call), output(propCall())]);
    expect((await run()).failed).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1]![0].prompt).toContain('Generation preflight');
  });

  it('leaves cycle checks to review when the referenced component exists', async () => {
    const { invoke, run } = setup([
      output(propCall(), { tool: 'classify_slot', slot: 'children', allowed_components: ['Card'] }),
    ]);
    expect((await run()).failed).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it.each([
    propCall({ cdf_type: 'enum' }),
    propCall({ cdf_type: 'enum', values: [] }),
    propCall({ cdf_type: 'token', token_kind: 'impossible' }),
  ])('regenerates classifications that violate the generation contract: %j', async (call) => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const { invoke, run } = setup([output(call), output(propCall())]);
    expect((await run()).failed).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it.each([
    propCall(),
    propCall({ cdf_type: 'token', cdf_category: 'design' }),
    propCall({ cdf_type: 'token', cdf_category: 'design', token_kind: 'color' }),
    propCall({ cdf_type: 'enum', values: ['small', 'large'] }),
  ])('accepts valid output or a token kind that can be settled later: %j', async (call) => {
    const { invoke, run } = setup([output(call)]);
    expect((await run()).failed).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
