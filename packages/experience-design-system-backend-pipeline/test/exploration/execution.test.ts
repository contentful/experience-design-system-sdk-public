import { describe, expect, it, vi } from 'vitest';
import * as pipeline from '../../src/index.js';

const api = pipeline;
import type {
  ExploreScope,
  ExploreScopeResult,
  ExplorationSourceInput,
} from '@contentful/experience-design-system-types';
import type { ExploreStageRequest } from '../../src/steps/exploration/src/types.js';
const component = { name: 'Panel', source: 'panel.tsx', componentId: 'panel' };
const scope = (
  index: number,
  included = true,
  slots: ExploreScopeResult['companion']['components'][number]['slots'] = [],
): ExploreScopeResult => ({
  scope: `components-${index}` as ExploreScope,
  report: 'source report',
  attempts: [],
  companion: { agentRole: `components-${index}` as ExploreScope, components: [{ ...component, included, slots }] },
});

describe('public exploration execution', () => {
  it('exports the connected callable stages and retained phase roster', () => {
    for (const name of [
      'runExploreStage',
      'parseExploreOutput',
      'deriveSelectionFromExploration',
      'deriveSlotsFromExploration',
      'diffExploration',
      'runTierStage',
      'runVerifyStage',
      'runCheckStage',
    ] as const) {
      expect(api[name], name).toBeTypeOf('function');
    }
    expect(pipeline).toHaveProperty('EXPLORE_MAX_ATTEMPTS', 6);
    expect(pipeline).toHaveProperty(
      'COMPONENT_SCOPES',
      Array.from({ length: 7 }, (_, i) => `components-${i + 1}`),
    );
  });

  it('uses actual active inclusion coverage and retains dissent', () => {
    const reports = [scope(1), scope(2), scope(3), scope(4, false)];
    expect(api.deriveSelectionFromExploration(reports, [component])[0]).toMatchObject({
      decision: 'accepted',
      votes: { accepted: 3, rejected: 1 },
      disputed: false,
    });
    expect(api.deriveSelectionFromExploration([scope(1), scope(2, false)], [component])[0].disputed).toBe(true);
  });

  it('conserves an open domain and ignores candidate-free slot votes', () => {
    const open = { name: 'renderBody', isRealSlot: true, allowedComponents: [] };
    const reports = [
      scope(1, true, [open]),
      scope(2, true, [open]),
      scope(3, true, [open]),
      scope(4),
      scope(5),
      scope(6, true, [{ ...open, isRealSlot: false }]),
      scope(7),
    ];
    const result = api.deriveSlotsFromExploration(reports, [component], new Set(['Panel']));
    expect(result.components[0].slots[0]).toMatchObject({ name: 'renderBody', allowedComponents: [], state: 'open' });
    const noQuorum = api.deriveSlotsFromExploration(reports.slice(1), [component], new Set(['Panel']));
    expect(noQuorum.components[0]?.slots ?? []).toEqual([]);
  });

  it('does not accept observation-only finite proposals', () => {
    const proposed = { name: 'body', isRealSlot: true, allowedComponents: ['Text'], evidence: ['observed child'] };
    const known = [component, { name: 'Text', source: 'text.tsx', componentId: 'text' }];
    const result = api.deriveSlotsFromExploration(
      [1, 2, 3].map((i) => scope(i, true, [proposed])),
      known,
      new Set(['Text']),
    );
    expect(result.components.flatMap((c) => c.slots).some((s) => s.state === 'finite')).toBe(false);
    expect(result.disputes.length).toBeGreaterThan(0);
  });

  it('requires canonical included candidate rulings and rejects malformed slot types', () => {
    const candidate = [{ component: 'Panel', source: 'panel.tsx', slots: ['renderBody'] }];
    const missing = JSON.stringify({ agentRole: 'components-1', components: [{ ...component, included: true }] });
    expect(api.parseExploreOutput).toBeTypeOf('function');
    expect(api.parseExploreOutput(missing, 'components-1', candidate)).toMatchObject({ ok: false });
    const malformed = JSON.stringify({
      agentRole: 'components-1',
      components: [{ ...component, included: true, slots: [{ name: 'renderBody', isRealSlot: 'yes' }] }],
    });
    expect(api.parseExploreOutput(malformed, 'components-1', candidate)).toMatchObject({ ok: false });
  });

  it('accounts for six failed attempts and aborts interruptible backoff', async () => {
    const invoker = { invoke: vi.fn(async () => ({ stdout: '', stderr: 'failed', exitCode: 1, timedOut: false })) };
    const request: ExploreStageRequest = {
      invoker,
      agent: 'codex',
      scopes: ['components-1'],
      rawComponentsInline: '[]',
      outDir: '',
      timeoutMs: 1000,
      backoffMs: 0,
      skillContentOverride: 'Inspect source.',
    };
    const result = await api.runExploreStage(request);
    expect(result.ok).toBe(false);
    expect(invoker.invoke).toHaveBeenCalledTimes(6);
    if (result.ok) throw new Error('Expected failed stage');
    expect(result.attempts).toHaveLength(6);
    const controller = new AbortController();
    invoker.invoke.mockImplementation(async () => {
      controller.abort();
      return { stdout: '', stderr: 'failed', exitCode: 1, timedOut: false };
    });
    await expect(
      api.runExploreStage({ ...request, signal: controller.signal, backoffMs: 10000 }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('exploration failure and report receipts', () => {
  it('accounts malformed prompt input inside all six attempts', async () => {
    const invoker = { invoke: vi.fn() };
    const result = await api.runExploreStage({
      invoker,
      agent: 'codex',
      scopes: ['components-1'],
      rawComponentsInline: 'malformed',
      outDir: '',
      timeoutMs: 1000,
      backoffMs: 0,
      skillContentOverride: 'Inspect source.',
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected failed stage');
    expect(result.attempts).toHaveLength(6);
    expect(invoker.invoke).not.toHaveBeenCalled();
  });
  it('passes a complete successful attempt receipt to durable report callbacks and removes candidate observations from scopes six/seven', async () => {
    const completed: unknown[] = [];
    const result = await api.runExploreStage({
      invoker: {
        invoke: async ({ prompt }: { prompt: string }) => {
          expect(prompt).not.toContain('candidate-marker');
          return {
            stdout: JSON.stringify({ agentRole: 'components-6', components: [] }),
            stderr: '',
            exitCode: 0,
            timedOut: false,
          };
        },
      },
      agent: 'codex',
      scopes: ['components-6'],
      rawComponentsInline: '[]',
      callSiteEvidenceInline: 'candidate-marker',
      sourceInput: {
        observations: { accepted: ['candidate-marker'], rejected: [] },
        files: [],
      } as unknown as ExplorationSourceInput,
      outDir: '',
      timeoutMs: 1000,
      backoffMs: 0,
      skillContentOverride: 'Inspect source.',
      onScopeComplete: (report: unknown) => {
        completed.push(report);
      },
    });
    expect(result.ok).toBe(true);
    expect(completed[0]).toMatchObject({ attempts: [{ attempt: 1, ok: true }] });
  });
  it('requires evidence for a true slot and never guesses requiredness from agreement', () => {
    const report = {
      agentRole: 'components-1',
      components: [{ ...component, included: true, slots: [{ name: 'renderBody', isRealSlot: true }] }],
    };
    expect(api.parseExploreOutput(JSON.stringify(report), 'components-1')).toMatchObject({ ok: false });
    const slots = [
      { name: 'renderBody', isRealSlot: true, allowedComponents: [], required: true, evidence: ['declared input'] },
    ];
    const result = api.deriveSlotsFromExploration(
      [1, 2, 3].map((i) => scope(i, true, slots)),
      [component],
      new Set(),
    );
    expect(result.decisions[0].required).toBeUndefined();
  });
});

describe('retained slot-domain controls', () => {
  const known = [component, { name: 'Text', source: 'text.tsx' }, { name: 'Icon', source: 'icon.tsx' }];
  const proof = {
    kind: 'declared' as const,
    applicable: true,
    supported: true,
    evidence: [{ source: 'panel.tsx', line: '1', quote: 'declared allowlist' }],
  };
  it('counts only covered eligible scopes and rejects unknown, excluded and self edges', () => {
    const finite = {
      name: 'renderBody',
      isRealSlot: true,
      allowedComponents: ['Text', 'Panel', 'Outside', 'Rejected'],
      restriction: proof,
    };
    const reports = [
      scope(1, true, [finite]),
      scope(2, true, [finite]),
      scope(3, true, [finite]),
      scope(4),
      scope(5),
      scope(6, true, [{ ...finite, isRealSlot: false }]),
    ];
    const result = api.deriveSlotsFromExploration(reports, known, new Set(['Text']));
    expect(result.decisions[0]).toMatchObject({
      state: 'finite',
      allowedComponents: ['Text'],
      coverage: 5,
      realVotes: 3,
    });
    expect(api.deriveSlotsFromExploration(reports.slice(1), known, new Set(['Text'])).decisions[0]?.state).toBe(
      'unresolved',
    );
    expect(
      api.deriveSlotsFromExploration(
        [scope(1, true, [finite]), scope(2, true, [finite]), scope(3)],
        known,
        new Set(['Text']),
      ).decisions[0]?.state,
    ).toBe('finite');
  });
  it('retains open votes, minority proposals and conservative conflict without treating external observations as exhaustive', () => {
    const open = { name: 'renderBody', isRealSlot: true, allowedComponents: ['Outside'] };
    const proposed = { ...open, allowedComponents: ['Text'] };
    const result = api.deriveSlotsFromExploration(
      [scope(1, true, [open]), scope(2, true, [open]), scope(3, true, [proposed])],
      known,
      new Set(['Text', 'Icon']),
    );
    expect(result.decisions[0]?.state).toBe('open');
    expect(result.disputes).toHaveLength(1);
    const conflict = api.deriveSlotsFromExploration(
      [
        scope(1, true, [proposed]),
        scope(2, true, [{ ...proposed, allowedComponents: ['Icon'] }]),
        scope(3, true, [open]),
      ],
      known,
      new Set(['Text', 'Icon']),
    );
    expect(conflict.decisions[0]?.state).toBe('unresolved');
  });
  it('documents canonical missing/excluded/source-mismatch parser bypasses without fabricating votes', () => {
    const candidates = [{ component: 'Panel', source: 'panel.tsx', slots: ['renderBody'] }];
    for (const components of [
      [],
      [{ ...component, included: false }],
      [{ ...component, source: 'other.tsx', included: true }],
    ]) {
      expect(
        api.parseExploreOutput(JSON.stringify({ agentRole: 'components-1', components }), 'components-1', candidates),
      ).toMatchObject({ ok: true });
    }
    const empty = scope(2);
    empty.companion.components = [];
    expect(api.deriveSelectionFromExploration([scope(1), empty], [component])[0]?.votes).toEqual({
      accepted: 1,
      rejected: 0,
    });
  });
});

it('retains the original companion report alongside parsed data in result and durable callback', async () => {
  const report = 'Original source analysis.';
  let saved: ExploreScopeResult | undefined;
  const result = await api.runExploreStage({
    agent: 'codex',
    outDir: '',
    timeoutMs: 1000,
    backoffMs: 0,
    scopes: ['components-1'],
    rawComponentsInline: '[]',
    skillContentOverride: 'Inspect source.',
    invoker: {
      invoke: async () => ({
        stdout: `${report}\n\`\`\`json\n{"agentRole":"components-1","components":[]}\n\`\`\``,
        stderr: '',
        exitCode: 0,
        timedOut: false,
      }),
    },
    onScopeComplete: (scope) => {
      saved = scope;
    },
  });
  expect(saved?.report).toBe(report);
  expect(result.ok && result.scopes[0]?.report).toBe(report);
});

it('preserves nested and falsy report values through parsing and unordered comparison', () => {
  const observedValues = [false, 0, '', null, { options: [0, false], nested: { enabled: false } }, ['a', 'a']];
  const companion = {
    agentRole: 'full-inventory-1',
    components: [{ ...component, props: [{ name: 'settings', observedValues, default: false }] }],
  };
  const parsed = api.parseExploreOutput(JSON.stringify(companion), 'full-inventory-1');
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.error);
  expect(parsed.companion.components[0]?.props?.[0]).toMatchObject({ observedValues, default: false });
  const reports: ExploreScopeResult[] = [1, 2, 3].map((index) => ({
    scope: `full-inventory-${index}` as ExploreScope,
    report: '',
    attempts: [],
    companion: {
      ...parsed.companion,
      agentRole: `full-inventory-${index}` as ExploreScope,
      components: [
        {
          ...component,
          props: [
            {
              name: 'settings',
              observedValues: index === 2 ? [...observedValues].reverse() : observedValues,
              default: false,
            },
          ],
        },
      ],
    },
  }));
  expect(api.diffExploration(reports, [component]).disagreements).toEqual([]);
  reports[2]!.companion.components[0]!.props![0]!.observedValues = [...observedValues.slice(0, -1), ['a']];
  expect(
    api
      .diffExploration(reports, [component])
      .disagreements.some((disagreement) => disagreement.field === 'observedValues'),
  ).toBe(true);
});
