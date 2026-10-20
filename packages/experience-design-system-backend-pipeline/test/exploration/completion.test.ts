import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerifyComponentWork, VerifiedItem } from '@contentful/experience-design-system-types';
import * as api from '../../src/index.js';

afterEach(() => vi.restoreAllMocks());
const roster = [{ name: 'Example', source: 'example.tsx', componentId: 'example' }];
const output = (value: unknown) => ({ stdout: JSON.stringify(value), stderr: '', exitCode: 0, timedOut: false });
const work = (name: string): VerifyComponentWork => ({
  component: name,
  source: `${name}.tsx`,
  callSites: [],
  sourceRef: {
    component: name,
    sourcePath: `${name}.tsx`,
    content: 'label: string;',
    sourceEvidence: {
      captureId: 'capture',
      captureDigest: 'digest',
      textHash: 'hash',
      coverage: 'complete-within-declared-bound',
      extractionByteBinding: 'verified-same',
      lineRanges: [{ startLine: 1, endLine: 1 }],
    },
  },
  items: [
    {
      itemId: `${name}-type`,
      kind: 'factual',
      claims: [
        {
          id: `${name}-type`,
          path: `${name}.label.type`,
          scope: 'prop',
          member: 'label',
          field: 'type',
          valuesByScope: {},
        },
      ],
    },
  ],
});
const verified = (name: string, outcome: VerifiedItem['outcome'] = 'confirmed'): VerifiedItem => ({
  itemId: `${name}-type`,
  component: name,
  source: `${name}.tsx`,
  outcome,
  resolved: [{ path: `${name}.label.type`, value: 'string' }],
  evidence: [{ source: `${name}.tsx`, line: '1', quote: 'label: string;' }],
  reason: 'Declared input.',
});
const assignment = (prompt: string) =>
  JSON.parse(prompt.split('\nAssignment:\n')[1]!.split('\n')[0]!) as {
    component: string;
    scope?: string;
    checkIds?: string[];
  };
const options = {
  agent: 'codex' as const,
  outDir: '',
  timeoutMs: 1000,
  backoffMs: 0,
  maxAttempts: 1,
  skillContentOverride: 'Inspect supplied source.',
};

describe('assigned exploration report coverage', () => {
  it.each([
    { components: [] },
    { components: [{ ...roster[0], source: 'other.tsx', included: true }] },
    { components: [{ ...roster[0], componentId: 'foreign', included: true }] },
    {
      components: [
        { ...roster[0], included: true },
        { name: 'Foreign', source: 'foreign.tsx', componentId: 'foreign', included: true },
      ],
    },
  ])('rejects omitted and foreign assigned identities: %j', ({ components }) => {
    const parsed = api.parseExploreOutput(
      JSON.stringify({ agentRole: 'components-1', components }),
      'components-1',
      [],
      roster,
    );
    expect(parsed.ok).toBe(false);
  });
  it('allows an explicit excluded assigned component without candidate votes', () => {
    expect(
      api.parseExploreOutput(
        JSON.stringify({ agentRole: 'components-1', components: [{ ...roster[0], included: false }] }),
        'components-1',
        [{ component: 'Example', source: 'example.tsx', slots: ['renderBody'] }],
        roster,
      ).ok,
    ).toBe(true);
  });
  it('counts omitted whole-component reports as failed attempts and preserves earlier successful reports', async () => {
    const completed: string[] = [];
    const result = await api.runExploreStage({
      ...options,
      maxAttempts: 6,
      scopes: ['components-1', 'components-2'],
      rawComponentsInline: JSON.stringify(roster),
      requestedComponents: roster,
      invoker: {
        invoke: async ({ prompt }) => {
          const scope = assignment(prompt).scope;
          return output({
            agentRole: scope,
            components: scope === 'components-1' ? [{ ...roster[0], included: false }] : [],
          });
        },
      },
      onScopeComplete: (report) => {
        completed.push(report.scope);
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected uncovered stage failure');
    expect(result.attempts).toHaveLength(6);
    expect(result.scopes).toHaveLength(1);
    expect(completed).toEqual(['components-1']);
  });
  it('returns explicit assigned, answered and excluded coverage to the saved report callback', async () => {
    const completed: unknown[] = [];
    const result = await api.runExploreStage({
      ...options,
      scopes: ['components-6'],
      rawComponentsInline: JSON.stringify(roster),
      requestedComponents: roster,
      invoker: {
        invoke: async () => output({ agentRole: 'components-6', components: [{ ...roster[0], included: false }] }),
      },
      onScopeComplete: (report) => {
        completed.push(report);
      },
    });
    expect(result.ok).toBe(true);
    expect(completed[0]).toMatchObject({
      coverage: { requested: roster, answered: roster, excluded: roster, complete: true },
    });
  });
});

describe('bounded verify/check execution', () => {
  it.each(['verify', 'check'] as const)('honors %s concurrency and retains input ordering', async (stage) => {
    let active = 0,
      peak = 0;
    const invoke = async ({ prompt }: { prompt: string }) => {
      const assigned = assignment(prompt);
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, assigned.component === 'First' ? 25 : 1));
      active--;
      return stage === 'verify'
        ? output({ items: [verified(assigned.component)] })
        : output({
            checks: [
              {
                checkId: assigned.checkIds![0],
                itemId: `${assigned.component}-type`,
                component: assigned.component,
                source: `${assigned.component}.tsx`,
                verdict: 'supports',
                reason: 'Exact declaration.',
              },
            ],
          });
    };
    const request = { ...options, components: [work('First'), work('Second')], concurrency: 2, invoker: { invoke } };
    const result =
      stage === 'verify'
        ? await api.runVerifyStage(request)
        : await api.runCheckStage({ ...request, verified: [verified('First'), verified('Second')] });
    expect(result.ok).toBe(true);
    expect(peak).toBe(2);
    if (!result.ok) throw new Error(result.error);
    expect(result.items.map((item) => item.component)).toEqual(['First', 'Second']);
    expect(result.attempts.map((attempt) => attempt.component)).toEqual(['First', 'Second']);
  });
  it('stops queued work after failure and drains already started verification', async () => {
    const called: string[] = [];
    let drained = false;
    const result = await api.runVerifyStage({
      ...options,
      components: [work('First'), work('Second'), work('Third')],
      concurrency: 2,
      invoker: {
        invoke: async ({ prompt }) => {
          const name = assignment(prompt).component;
          called.push(name);
          if (name === 'First') return { ...output({}), exitCode: 1 };
          await new Promise((resolve) => setTimeout(resolve, 25));
          drained = true;
          return output({ items: [verified(name)] });
        },
      },
    });
    expect(result.ok).toBe(false);
    expect([...called].sort()).toEqual(['First', 'Second']);
    expect(drained).toBe(true);
    expect(result.attempts).toHaveLength(2);
  });
});

it('does not accept an invocation that returns after the operation deadline', async () => {
  let time = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => time);
  const result = await api.runExploreStage({
    ...options,
    operationTimeoutMs: 10,
    scopes: ['components-1'],
    rawComponentsInline: '[]',
    invoker: {
      invoke: async () => {
        time += 11;
        return output({ agentRole: 'components-1', components: [] });
      },
    },
  });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected operation deadline failure');
  expect(result.attempts).toHaveLength(1);
  expect(result.attempts[0]?.ok).toBe(false);
});

describe('explicit bounded stage context paths', () => {
  it('reads requested reference, model and caller files relative to the supplied root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'stage-context-'));
    try {
      writeFileSync(join(root, 'reference.txt'), 'REFERENCE_CONTEXT_MARKER');
      writeFileSync(join(root, 'model.json'), 'MODEL_CONTEXT_MARKER');
      writeFileSync(join(root, 'calls.json'), 'CALLER_CONTEXT_MARKER');
      let prompt = '';
      const result = await api.runExploreStage({
        ...options,
        scopes: ['components-1'],
        rawComponentsInline: '[]',
        projectRoot: root,
        sdkReferencePath: 'reference.txt',
        existingModelPath: 'model.json',
        callSiteEvidencePath: 'calls.json',
        invoker: {
          invoke: async (request) => {
            prompt = request.prompt;
            return output({ agentRole: 'components-1', components: [] });
          },
        },
      });
      expect(result.ok).toBe(true);
      for (const marker of ['REFERENCE_CONTEXT_MARKER', 'MODEL_CONTEXT_MARKER', 'CALLER_CONTEXT_MARKER'])
        expect(prompt).toContain(marker);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('accounts missing explicitly requested path input as stage failure before model dispatch', async () => {
    const invoke = vi.fn(async () => output({ agentRole: 'components-1', components: [] }));
    const result = await api.runExploreStage({
      ...options,
      scopes: ['components-1'],
      rawComponentsInline: '[]',
      sdkReferencePath: '/nonexistent-example/reference.txt',
      invoker: { invoke },
    });
    expect(result.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('complete stage failure budgets', () => {
  it.each(['timeout', 'nonzero', 'exception', 'parser'] as const)(
    'records all six %s attempts through the actual exploration stage',
    async (failure) => {
      const attempts: unknown[] = [];
      const invoke = vi.fn(async () => {
        if (failure === 'exception') throw new Error('Invocation failed.');
        if (failure === 'parser') return { ...output({}), stdout: 'malformed' };
        return { ...output({}), exitCode: failure === 'nonzero' ? 1 : 0, timedOut: failure === 'timeout' };
      });
      const result = await api.runExploreStage({
        ...options,
        maxAttempts: undefined,
        scopes: ['components-1'],
        rawComponentsInline: '[]',
        invoker: { invoke },
        onAttempt: (attempt) => {
          attempts.push(attempt);
        },
      });
      expect(result.ok).toBe(false);
      expect(invoke).toHaveBeenCalledTimes(6);
      expect(attempts).toHaveLength(6);
      if (result.ok) throw new Error('Expected exhausted attempts');
      expect(new Set(result.attempts.map((attempt) => attempt.operationId)).size).toBe(1);
      expect(result.attempts.every((attempt) => attempt.ok === false && attempt.stage === 'components-1')).toBe(true);
    },
  );
  it('records bounded UTF-8 prompt failures without invoking the model', async () => {
    const invoke = vi.fn(async () => output({}));
    const result = await api.runExploreStage({
      ...options,
      maxAttempts: undefined,
      maxPromptBytes: 128,
      skillContentOverride: '🙂'.repeat(100),
      scopes: ['components-1'],
      rawComponentsInline: '[]',
      invoker: { invoke },
    });
    expect(result.ok).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    if (result.ok) throw new Error('Expected bounded prompt failure');
    expect(result.attempts).toHaveLength(6);
  });
  it('retains concurrent check attempts after a failed sibling and dispatches no queued work', async () => {
    const called: string[] = [];
    let drained = false;
    const result = await api.runCheckStage({
      ...options,
      components: [work('First'), work('Second'), work('Third')],
      verified: ['First', 'Second', 'Third'].map((name) => verified(name)),
      concurrency: 2,
      invoker: {
        invoke: async ({ prompt }) => {
          const assigned = assignment(prompt);
          called.push(assigned.component);
          if (assigned.component === 'First') return { ...output({}), exitCode: 1 };
          await new Promise((resolve) => setTimeout(resolve, 10));
          drained = true;
          return output({
            checks: [
              {
                checkId: assigned.checkIds![0],
                itemId: `${assigned.component}-type`,
                component: assigned.component,
                source: `${assigned.component}.tsx`,
                verdict: 'supports',
                reason: 'Exact evidence.',
              },
            ],
          });
        },
      },
    });
    expect(result.ok).toBe(false);
    expect([...called].sort()).toEqual(['First', 'Second']);
    expect(drained).toBe(true);
    expect(result.attempts).toHaveLength(2);
  });
  it('drains started work and stops queued verification on abort', async () => {
    const controller = new AbortController();
    const called: string[] = [];
    let drained = false;
    const pending = api.runVerifyStage({
      ...options,
      components: [work('First'), work('Second'), work('Third')],
      concurrency: 2,
      signal: controller.signal,
      invoker: {
        invoke: async ({ prompt }) => {
          const name = assignment(prompt).component;
          called.push(name);
          await new Promise((resolve) => setTimeout(resolve, 10));
          if (name === 'First') controller.abort();
          else drained = true;
          return output({ items: [verified(name)] });
        },
      },
    });
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect([...called].sort()).toEqual(['First', 'Second']);
    expect(drained).toBe(true);
  });
  it.each([0, -1, 1.5, Infinity, NaN])('rejects invalid concurrency %s without dispatch', async (concurrency) => {
    const invoke = vi.fn(async () => output({}));
    await expect(
      api.runVerifyStage({ ...options, components: [work('First')], concurrency, invoker: { invoke } }),
    ).rejects.toThrow('concurrency');
    expect(invoke).not.toHaveBeenCalled();
  });
});

it('keeps disjoint source gaps and malformed resolution sets uncertain', () => {
  const sourceInput = {
    coverage: 'complete-within-declared-bound',
    promptCoverage: 'complete-within-declared-bound',
    extractionByteBinding: 'unverified',
    files: [
      {
        path: 'First.tsx',
        ranges: [
          { startLine: 1, endLine: 1, text: 'label: string;' },
          { startLine: 3, endLine: 3, text: 'enabled: boolean;' },
        ],
      },
    ],
  } as unknown as import('@contentful/experience-design-system-types').ExplorationSourceInput;
  for (const item of [
    {
      ...verified('First'),
      evidence: [{ source: 'First.tsx', line: '1-3', quote: 'label: string;\nenabled: boolean;' }],
    },
    {
      ...verified('First'),
      resolved: [
        { path: 'First.label.type', value: 'string' },
        { path: 'First.label.type', value: 'string' },
      ],
    },
    { ...verified('First'), resolved: [] },
  ]) {
    const result = api.parseVerifyOutput(JSON.stringify({ items: [item] }), work('First'), sourceInput);
    expect(result.ok && result.items[0]?.outcome).toBe('conflicting');
  }
});

it('does not create a named slot from slotless component evidence', () => {
  const reports = [1, 2, 3].map((index) => ({
    scope: `components-${index}` as import('@contentful/experience-design-system-types').ExploreScope,
    report: '',
    attempts: [],
    companion: {
      agentRole: `components-${index}` as import('@contentful/experience-design-system-types').ExploreScope,
      components: [{ ...roster[0], included: true, slots: [] }],
    },
  }));
  expect(api.deriveSlotsFromExploration(reports, roster, new Set(['Example'])).decisions).toEqual([]);
});

describe('bounded optional existing context', () => {
  it('keeps oversized, malformed and missing optional context unavailable', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'exploration-existing-'));
    try {
      const path = join(directory, 'existing.json');
      writeFileSync(path, 'x'.repeat(1025));
      expect(await api.loadExistingExplorationContext(path, { maxBytes: 1024 })).toMatchObject({
        status: 'unavailable',
      });
      writeFileSync(path, 'malformed');
      expect(await api.loadExistingExplorationContext(path)).toMatchObject({ status: 'unavailable' });
      expect(await api.loadExistingExplorationContext(join(directory, 'missing.json'))).toMatchObject({
        status: 'unavailable',
      });
      expect(await api.loadExistingExplorationContext(undefined)).toEqual({ status: 'absent' });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('retains optional context cancellation as fatal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(api.loadExistingExplorationContext(undefined, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
