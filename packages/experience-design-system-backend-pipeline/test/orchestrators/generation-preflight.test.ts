import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { buildCDF, validateCDF } from '@contentful/experience-design-system-types';
import {
  copyComponentFromCache,
  getOrCreateSession,
  loadCDFComponents,
  loadRawComponents,
  openPipelineDb,
  storeRawComponents,
} from '../../src/persistence/src/session/repositories/db.js';
import { storeGenerationReviewDraft } from '../../src/persistence/src/session/repositories/generation-review-drafts.js';
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

function setup(
  outputs: ReturnType<typeof output>[],
  props: Parameters<typeof storeRawComponents>[2][number]['props'] = [
    { name: 'label', type: 'string', required: false },
  ],
) {
  const db = openPipelineDb(':memory:');
  databases.push(db);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  storeRawComponents(db, sessionId, [
    {
      name: 'Card',
      source: 'src/Card.tsx',
      framework: 'react',
      props,
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
  const nullableChoice = {
    name: 'label',
    type: "'primary' | 'default' | 'dashed' | null",
    required: false,
    defaultValue: 'null',
    allowedValues: ['primary', 'default', 'dashed'],
  };
  const choiceCall = (overrides = {}) =>
    propCall({ cdf_category: 'design', required: false, values: ['primary', 'default', 'dashed'], ...overrides });

  it('generates a nullable finite choice whose source default is null without a default', async () => {
    const { db, sessionId, invoke, run } = setup([output(choiceCall())], [nullableChoice]);
    const result = await run();

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(false);
    expect(loadCDFComponents(db, sessionId)[0]!.entry.$properties.label).toEqual({
      $type: 'string',
      $category: 'design',
      $values: ['primary', 'default', 'dashed'],
    });
    expect(validateCDF(buildCDF(loadCDFComponents(db, sessionId), [])).valid).toBe(true);
  });

  it.each(['undefined', ' null '])('projects no default for the %j source default', async (defaultValue) => {
    const { db, sessionId, run } = setup(
      [output(propCall({ cdf_type: 'boolean', cdf_category: 'state' }))],
      [{ name: 'label', type: 'boolean | null', required: false, defaultValue }],
    );
    await run();

    expect(loadCDFComponents(db, sessionId)[0]!.entry.$properties.label).toEqual({
      $type: 'boolean',
      $category: 'state',
    });
  });

  it('replaces a retained invalid proposal when restoring a valid cached component', async () => {
    const { db, sessionId, run } = setup([output(propCall())]);
    await run();
    const raw = loadRawComponents(db, sessionId);
    const target = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' }).sessionId;
    storeRawComponents(db, target, raw);
    storeGenerationReviewDraft(db, target, raw[0]!.component_id, {
      entry: { $type: 'component', $properties: {}, $slots: { invented: {} } },
      error: 'Invalid slot',
      agentOutput: '',
    });
    copyComponentFromCache(db, sessionId, target, raw[0]!.component_id);
    expect(loadCDFComponents(db, target)[0]!.entry.$properties.label).toEqual({
      $type: 'string',
      $category: 'content',
    });
    expect(loadCDFComponents(db, target)[0]!.entry.$slots?.invented).toBeUndefined();
    expect(db.prepare('SELECT cdf_schema FROM raw_components WHERE session_id = ?').get(target)).toEqual({
      cdf_schema: null,
    });
  });

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

  it('retains the final invalid proposal for review after bounded retries without caching it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const invalid = output(propCall({ token_kind: '' }));
    const { db, sessionId, invoke, events, run } = setup([invalid, invalid]);
    const result = await run();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(result.failed).toBe(true);
    expect(result.failureKind).toBe('preflight');
    expect(result.error).toContain('$token.kind');
    expect(result.reviewRequired).toBe(true);
    expect(loadCDFComponents(db, sessionId)[0]?.entry.$properties.label).toEqual({
      $type: 'string',
      $category: 'content',
      '$token.kind': '',
    });
    expect(db.prepare('SELECT * FROM generation_cache').all()).toEqual([]);
    expect(db.prepare('SELECT cdf_type FROM raw_props').get()).toEqual({ cdf_type: null });
    expect(events.some((event) => event.kind === 'component:completed')).toBe(false);
  });

  it('keeps the final invented slot and valid fields visible instead of dropping the proposal', async () => {
    const first = output(propCall({ description: 'First attempt' }), {
      tool: 'classify_slot',
      slot: 'invented',
      description: 'First slot',
    });
    const last = output(propCall({ description: 'Last attempt' }), {
      tool: 'classify_slot',
      slot: 'invented',
      description: 'Last slot',
    });
    const { db, sessionId, events, run } = setup([first, last]);
    const result = await run();
    expect(result).toMatchObject({ failed: true, failureKind: 'preflight', reviewRequired: true });
    const entry = loadCDFComponents(db, sessionId)[0]!.entry;
    expect(entry.$properties.label.$description).toBe('Last attempt');
    expect(entry.$slots?.invented?.$description).toBe('Last slot');
    expect(db.prepare('SELECT * FROM generation_cache').all()).toEqual([]);
    expect(events.at(-1)?.kind).toBe('component:review-required');
  });

  it.each([
    { call: propCall({ cdf_type: 'enum', values: [] }), expected: { $type: 'enum', $values: [] } },
    { call: propCall({ cdf_type: 'impossible' }), expected: { $type: 'impossible' } },
    {
      call: propCall({ cdf_type: 'token', token_kind: 'impossible' }),
      expected: { $type: 'token', '$token.kind': 'impossible' },
    },
  ])('retains invalid classification details for manual repair: %j', async ({ call, expected }) => {
    const { db, sessionId, run } = setup([output(call), output(call)]);
    expect((await run()).reviewRequired).toBe(true);
    expect(loadCDFComponents(db, sessionId)[0]?.entry.$properties.label).toMatchObject(expected);
  });

  it('keeps unknown allowed-component references in the review proposal', async () => {
    const invalid = output(propCall(), {
      tool: 'classify_slot',
      slot: 'children',
      allowed_components: ['MissingComponent'],
    });
    const { db, sessionId, run } = setup([invalid, invalid]);
    await run();
    expect(loadCDFComponents(db, sessionId)[0]?.entry.$slots?.children.$allowedComponents).toEqual([
      'MissingComponent',
    ]);
  });

  it('replaces a retained draft after a later successful generation and clears its warning', async () => {
    const invalid = output(propCall({ cdf_type: 'enum', values: [] }));
    const { db, sessionId, invoke, run } = setup([invalid, invalid]);
    await run();
    invoke.mockResolvedValueOnce(output(propCall({ cdf_type: 'string', values: ['primary', 'secondary'] })));
    expect((await run()).failed).toBe(false);
    expect(loadCDFComponents(db, sessionId)[0]?.entry.$properties.label.$values).toEqual(['primary', 'secondary']);
    expect(db.prepare('SELECT cdf_schema FROM raw_components').get()).toEqual({ cdf_schema: null });
    expect(db.prepare('SELECT * FROM generation_cache').all()).toHaveLength(1);
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
    propCall({ cdf_type: 'string', values: ['small', 'large'] }),
  ])('accepts valid output or a token kind that can be settled later: %j', async (call) => {
    const { invoke, run } = setup([output(call)]);
    expect((await run()).failed).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
