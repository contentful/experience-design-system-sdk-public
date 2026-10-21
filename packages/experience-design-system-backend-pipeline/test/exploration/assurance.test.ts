import { describe, expect, it } from 'vitest';
import * as pipeline from '../../src/index.js';

const api = pipeline;
import type {
  VerifyComponentWork,
  VerifiedItem,
  EvidenceCheck,
  ExploreScope,
  ExploreScopeResult,
  JsonValue,
} from '@contentful/experience-design-system-types';
const work: VerifyComponentWork = {
  component: 'Panel',
  source: 'panel.tsx',
  callSites: [],
  sourceRef: {
    component: 'Panel',
    sourcePath: 'panel.tsx',
    content: 'title: string;\nbody: unknown;',
    sourceEvidence: {
      captureId: 'capture',
      captureDigest: 'digest',
      textHash: 'hash',
      coverage: 'complete-within-declared-bound',
      extractionByteBinding: 'verified-same',
      lineRanges: [{ startLine: 1, endLine: 2 }],
    },
  },
  items: [
    {
      itemId: 'title-type',
      kind: 'factual',
      claims: [
        {
          id: 'title-type',
          path: 'Panel.title.type',
          scope: 'prop',
          member: 'title',
          field: 'type',
          valuesByScope: {},
        },
      ],
    },
  ],
};
const item: VerifiedItem = {
  itemId: 'title-type',
  component: 'Panel',
  source: 'panel.tsx',
  outcome: 'confirmed',
  resolved: [{ path: 'Panel.title.type', value: 'string' }],
  evidence: [{ source: 'panel.tsx', line: '1', quote: 'title: string;' }],
  reason: 'Declared input.',
};

describe('source-bound detail assurance', () => {
  it('requires complete resolution and exact file, line and quote bindings', () => {
    expect(api.parseVerifyOutput).toBeTypeOf('function');
    expect(api.parseVerifyOutput(JSON.stringify({ items: [item] }), work)).toMatchObject({ ok: true });
    for (const evidence of [
      { source: 'other.tsx', line: '1', quote: 'title: string;' },
      { source: 'panel.tsx', line: '2', quote: 'title: string;' },
      { source: 'panel.tsx', line: '1', quote: 'missing declaration' },
    ]) {
      const parsed = api.parseVerifyOutput(JSON.stringify({ items: [{ ...item, evidence: [evidence] }] }), work);
      expect(parsed.ok ? parsed.items[0]!.outcome : 'conflicting').toBe('conflicting');
    }
    const missing = api.parseVerifyOutput(JSON.stringify({ items: [{ ...item, resolved: [] }] }), work);
    expect(missing.ok ? missing.items[0]!.outcome : 'conflicting').toBe('conflicting');
  });

  it('does not retain confirmation without an independent support check', () => {
    expect(api.applyChecks).toBeTypeOf('function');
    expect(api.applyChecks([item], [])[0]!).toMatchObject({ outcome: 'conflicting', downgraded: true });
    const supported: EvidenceCheck[] = [
      {
        checkId: 'check-title-type',
        itemId: item.itemId,
        component: item.component,
        source: item.source,
        verdict: 'supports',
        reason: 'Evidence establishes the claim.',
      },
    ];
    expect(api.applyChecks([item], supported)[0]!.outcome).toBe('confirmed');
  });

  it('retains unordered nested multiplicity and the first eligible description', () => {
    expect(api.diffExploration).toBeTypeOf('function');
    const report = (scope: ExploreScope, observedValues: JsonValue[], description: string): ExploreScopeResult => ({
      scope,
      report: '',
      attempts: [],
      companion: {
        agentRole: scope,
        components: [
          {
            name: 'Panel',
            source: 'panel.tsx',
            props: [
              {
                name: 'title',
                observedValues,
                description,
              },
            ],
          },
        ],
      },
    });
    const same = api.diffExploration([
      report('full-inventory-1', ['a', 'b', 'a'], 'first'),
      report('full-inventory-2', ['a', 'a', 'b'], 'second'),
    ]);
    expect(same.disagreements).toHaveLength(0);
    expect(same.consensus.find((field) => field.path.endsWith('.description'))!.value).toBe('first');
    const different = api.diffExploration([
      report('full-inventory-1', ['a', 'b', 'a'], 'first'),
      report('full-inventory-2', ['a', 'b'], 'second'),
    ]);
    expect(different.disagreements).toHaveLength(1);
  });
});

it('binds multiple tier batches to their exact requested work IDs without colliding attempt receipts', async () => {
  const disagreements = Array.from({ length: 18 }, (_, index) => ({
    id: `claim-${index}`,
    component: 'Panel',
    source: 'panel.tsx',
    scope: 'prop' as const,
    member: 'title',
    field: 'type',
    path: `Panel.title.${index}`,
    valuesByScope: {},
    reasonsByScope: {},
  }));
  const result = await api.runTierStage({
    agent: 'codex',
    outDir: '',
    timeoutMs: 1000,
    backoffMs: 0,
    disagreements,
    skillContentOverride: 'Tier claims.',
    invoker: {
      invoke: async ({ prompt }) => {
        const assignment = JSON.parse(prompt.split('\nAssignment:\n')[1]!.split('\n')[0]!) as { ids: string[] };
        return {
          stdout: JSON.stringify({
            hypotheses: assignment.ids.map((id) => ({
              disagreementIds: [id],
              hypothesis: 'Read the declaration.',
              tier: 'factual',
              tierReason: 'Declared source.',
            })),
          }),
          stderr: '',
          exitCode: 0,
          timedOut: false,
        };
      },
    },
  });
  expect(result.ok).toBe(true);
  expect(result.attempts).toHaveLength(2);
  expect(new Set(result.attempts.map((attempt) => attempt.operationId)).size).toBe(2);
  expect(result.attempts.flatMap((attempt) => attempt.workIds ?? [])).toEqual(disagreements.map((entry) => entry.id));
});
