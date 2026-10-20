import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureSourceEvidence } from '@contentful/experience-design-system-extraction';
import type { ExploreComponentReport, VerifiedItem } from '../../src/index.js';
import type { AgentRunResult } from '../../src/agents/types/agent-run.js';
const generated = vi.hoisted(() => ({ prompts: [] as string[], mutate: undefined as (() => void) | undefined }));
vi.mock('../../src/agents/invoker/create-local-cli-agent-invoker.js', () => ({
  createLocalCliAgentInvoker: () => ({
    invoke: async ({ prompt }: { prompt: string }) => {
      generated.prompts.push(prompt);
      generated.mutate?.();
      return {
        stdout: [
          { tool: 'classify_component', description: 'A configurable surface.' },
          { tool: 'classify_prop', prop: 'title', cdf_type: 'string', cdf_category: 'content', required: false },
          { tool: 'classify_slot', slot: 'renderBody', allowed_components: ['Helper'], required: true },
        ]
          .map((call) => JSON.stringify(call))
          .join('\n'),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      };
    },
  }),
}));
import * as api from '../../src/index.js';
import type { CheckWork } from '../../src/steps/exploration/src/helpers/build-check-work.js';
import type { VerifyComponentWork } from '@contentful/experience-design-system-types';
let directory: string;
let previousDb: string | undefined;
afterEach(() => {
  generated.prompts = [];
  generated.mutate = undefined;
  if (previousDb === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
  else process.env.EDS_PIPELINE_DB_PATH = previousDb;
  if (directory) rmSync(directory, { recursive: true, force: true });
});
async function seed(slotNames = ['renderBody']) {
  directory = mkdtempSync(join(tmpdir(), 'exploration-consumers-'));
  previousDb = process.env.EDS_PIPELINE_DB_PATH;
  process.env.EDS_PIPELINE_DB_PATH = join(directory, 'pipeline.db');
  const raw = ['Panel', 'Text', 'Helper'].map((name) => {
    const source = join(directory, `${name}.tsx`);
    writeFileSync(
      source,
      `export interface ${name}Props { title?: string }\nexport const allowedComponents = ['Text'];\nexport const ${name} = (props: ${name}Props) => <section>{props.title}</section>;\n`,
    );
    return {
      name,
      source,
      sourcePath: source,
      framework: 'react' as const,
      props: [{ name: 'title', type: 'string', required: false, defaultValue: '' }],
      slots:
        name === 'Panel' ? slotNames.map((name) => ({ name, isDefault: false, allowedComponents: ['Helper'] })) : [],
    };
  });
  const db = api.openPipelineDb();
  const { sessionId } = api.getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  api.storeRawComponents(db, sessionId, raw);
  const stored = api.loadRawComponents(db, sessionId);
  const stepId = api.createStep(db, sessionId, 'analyze extract', { project: directory });
  const capture = await captureSourceEvidence({
    projectRoot: directory,
    filePaths: raw.map((raw) => raw.source),
    components: stored.map((component) => ({
      componentId: component.component_id,
      name: component.name,
      sourcePath: component.source,
    })),
  });
  const handle = api.completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId,
    capture,
    components: raw,
    scannedFiles: raw.map((raw) => raw.source),
    cycles: [],
    observations: { accepted: [], rejected: [] },
  });
  db.close();
  const decisions = {
    accepted: ['Panel', 'Text'],
    rejected: ['Helper'],
    acceptedProvenance: {
      Panel: { kind: 'direct' as const, roots: ['Panel'] },
      Text: { kind: 'closure' as const, roots: ['Panel'] },
    },
  };
  const requested: string[] = [];
  const invoker = {
    invoke: async ({ prompt }: { prompt: string }): Promise<AgentRunResult> => {
      const assignment = JSON.parse(prompt.split('\nAssignment:\n')[1]!.split('\n')[0]!) as {
        scope?: string;
        ids?: string[];
      };
      const input = JSON.parse(prompt.split('\nInput data:\n')[1]!.split('\n')[0]!);
      let output: unknown;
      if (assignment.scope) {
        requested.push(assignment.scope);
        const components: ExploreComponentReport[] = (input.components as typeof stored).map((component) => ({
          name: component.name,
          source: component.source,
          componentId: component.component_id,
          included: component.name !== 'Helper',
          props: assignment.scope!.startsWith('full-')
            ? [
                {
                  name: 'title',
                  type: assignment.scope === 'full-inventory-2' ? 'enum' : 'string',
                  description: 'Declared content.',
                },
              ]
            : [],
          slots:
            component.name === 'Panel' && !['components-6', 'components-7'].includes(assignment.scope!)
              ? slotNames.map((name) => ({
                  name,
                  isRealSlot: true,
                  allowedComponents: ['Text'],
                  evidence: ['Explicit declared component allowlist'],
                  restriction: {
                    kind: 'declared',
                    applicable: true,
                    evidence: [
                      {
                        source: input.sourceInput.files.find((file: { path: string }) =>
                          file.path.endsWith(`/${component.name}.tsx`),
                        ).path,
                        line: '2',
                        quote: "export const allowedComponents = ['Text'];",
                      },
                    ],
                  },
                }))
              : [],
        }));
        if (assignment.scope.startsWith('full-'))
          expect(components.map((component) => component.name)).toEqual(['Panel', 'Text']);
        output = { agentRole: assignment.scope, components };
      } else if (prompt.startsWith('Task: tier')) {
        output = {
          hypotheses: (assignment.ids ?? []).map((id) => ({
            disagreementIds: [id],
            hypothesis: 'Inspect the declared input type.',
            tier: 'factual',
            tierReason: 'Declared source fact.',
          })),
        };
      } else if (prompt.startsWith('Task: verify')) {
        const work = input.work as VerifyComponentWork;
        const items: VerifiedItem[] = work.items.map((item) => ({
          itemId: item.itemId,
          component: work.component,
          source: work.source,
          outcome: 'resolved',
          resolved: item.claims.map((claim) => ({ path: claim.path, value: 'string' })),
          evidence: [
            {
              source: input.source.files.find((file: { path: string }) => file.path.endsWith(`/${work.component}.tsx`))
                .path,
              line: '1',
              quote: `export interface ${work.component}Props { title?: string }`,
            },
          ],
          reason: 'Declared input type.',
        }));
        output = { items };
      } else {
        const work = input as CheckWork;
        output = {
          checks: work.entries.map((entry) => ({
            checkId: entry.checkId,
            itemId: entry.itemId,
            component: work.component,
            source: work.source,
            verdict: 'supports',
            reason: 'The exact source supports this claim.',
          })),
        };
      }
      return { stdout: JSON.stringify(output), stderr: '', exitCode: 0, timedOut: false };
    },
  };
  const request = {
    sessionId,
    sourceEvidenceHandle: handle,
    agent: 'codex' as const,
    invoker,
    backoffMs: 0,
    rendererReference: {
      kind: 'text' as const,
      text: 'Declared inputs define the component surface.',
      origin: 'fixture',
    },
  };
  return { sessionId, decisions, requested, request };
}
describe('actual accepted session consumers', () => {
  it('uses independently checked finite edges at the cold gate, selected detail, fresh generation and final review/export', async () => {
    const { sessionId, decisions, requested, request } = await seed();
    expect((await api.runExplorationComponentsSession(request)).ok).toBe(true);
    let db = api.openPipelineDb();
    const rawBefore = api.loadRawComponents(db, sessionId);
    try {
      expect(api.loadScopeComponents(db, sessionId).find((component) => component.name === 'Panel')?.slots).toEqual([
        { name: 'renderBody', allowedComponents: ['Text'] },
      ]);
      expect(api.loadAcceptedSlotDecisions(db, sessionId)?.find((slot) => slot.name === 'Panel')).toMatchObject({
        state: 'finite',
        evidence: expect.arrayContaining([expect.objectContaining({ line: '2' })]),
      });
      api.applyScopeDecisions(db, sessionId, decisions);
    } finally {
      db.close();
    }
    expect((await api.runExplorationDetailSession({ ...request, selectedNames: decisions.accepted })).ok).toBe(true);
    db = api.openPipelineDb();
    try {
      expect(api.loadRawComponents(db, sessionId)).toEqual(rawBefore);
      const detail = api.loadComponentReviewMetadata(db, sessionId, 'Panel')?.exploration?.detail;
      expect(detail?.recordOnly).toBe(true);
      expect(detail?.verified.some((item) => item.outcome === 'resolved')).toBe(true);
      expect(detail?.diff.scopesRead).toBe(10);
    } finally {
      db.close();
    }
    const generatedResult = await api.runGenerateComponentsSession({
      sessionId,
      agent: 'codex',
      promptOverrides: ['generate=text:Classify source inputs.'],
      noCache: false,
    });
    expect(generatedResult.allOk).toBe(true);
    expect(generated.prompts).toHaveLength(2);
    expect(generated.prompts.find((prompt) => prompt.includes('"name": "Panel"'))).toContain('"Text"');
    expect(requested).toHaveLength(10);
    db = api.openPipelineDb();
    try {
      const entries = api.loadCDFComponents(db, sessionId);
      const panel = entries.find((entry) => entry.key === 'Panel')!;
      expect(panel.entry.$slots).toEqual({ renderBody: { $allowedComponents: ['Text'] } });
      expect(api.loadRawComponents(db, sessionId).find((raw) => raw.name === 'Panel')?.slots).toEqual(
        rawBefore.find((raw) => raw.name === 'Panel')?.slots,
      );
      const slotBefore = api.loadAcceptedSlotDecisions(db, sessionId)?.find((slot) => slot.name === 'Panel');
      api.storeCDFComponents(db, sessionId, entries);
      expect(api.loadAcceptedSlotDecisions(db, sessionId)?.find((slot) => slot.name === 'Panel')).toEqual(slotBefore);
      api.storeCDFComponents(db, sessionId, [
        { ...panel, entry: { ...panel.entry, $slots: { renderBody: { $required: false } } } },
      ]);
      expect(api.loadCDFComponents(db, sessionId).find((entry) => entry.key === 'Panel')?.entry.$slots).toEqual({
        renderBody: { $required: false },
      });
      expect(api.loadComponentReviewMetadata(db, sessionId, 'Panel')?.scopeProvenance).toEqual(
        decisions.acceptedProvenance.Panel,
      );
    } finally {
      db.close();
    }
  });
  it('fences detail replay and generation writes when saved human choices change', async () => {
    const { sessionId, decisions, request } = await seed();
    await api.runExplorationComponentsSession(request);
    let db = api.openPipelineDb();
    api.applyScopeDecisions(db, sessionId, decisions);
    db.close();
    await api.runExplorationDetailSession(request);
    generated.mutate = () => {
      const db = api.openPipelineDb();
      try {
        api.applyScopeDecisions(db, sessionId, { accepted: [], rejected: ['Panel', 'Text', 'Helper'] });
      } finally {
        db.close();
      }
    };
    await expect(
      api.runGenerateComponentsSession({
        sessionId,
        agent: 'codex',
        promptOverrides: ['generate=text:Classify source.'],
        noCache: false,
      }),
    ).rejects.toThrow('scope or source changed');
    db = api.openPipelineDb();
    try {
      expect(api.loadExplorationRecord(db, sessionId, 'detail', 'detail')).toBeUndefined();
      expect(
        api
          .loadRawComponents(db, sessionId)
          .every((component) => component.props.every((prop) => prop.type === 'string')),
      ).toBe(true);
    } finally {
      db.close();
    }
  });
});

it('loads path/text detail overrides and bounded existing context into each actual selected stage', async () => {
  const { sessionId, decisions, request } = await seed();
  expect((await api.runExplorationComponentsSession(request)).ok).toBe(true);
  const db = api.openPipelineDb();
  api.applyScopeDecisions(db, sessionId, decisions);
  db.close();
  const detailPath = join(directory, 'detail.md'),
    checkPath = join(directory, 'check.md'),
    contextPath = join(directory, 'existing.json');
  writeFileSync(detailPath, 'DETAIL_OVERRIDE_MARKER');
  writeFileSync(checkPath, 'CHECK_OVERRIDE_MARKER');
  writeFileSync(
    contextPath,
    JSON.stringify({
      components: [{ sys: { id: 'existing' }, name: 'EXISTING_COMPONENT_MARKER', description: 'Prior choice.' }],
      tokens: [{ sys: { id: 'token' }, type: 'color', name: 'example/color' }],
    }),
  );
  const prompts: string[] = [];
  const result = await api.runExplorationDetailSession({
    ...request,
    selectedNames: decisions.accepted,
    concurrency: 2,
    existingEntitiesPath: contextPath,
    promptOverrides: [
      `detail=${detailPath}`,
      'tier=TIER_OVERRIDE_MARKER',
      'verify=VERIFY_OVERRIDE_MARKER',
      `check=${checkPath}`,
    ],
    invoker: {
      invoke: async (options) => {
        prompts.push(options.prompt);
        return request.invoker.invoke(options);
      },
    },
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  for (const [stage, marker] of [
    ['explore-inventory', 'DETAIL_OVERRIDE_MARKER'],
    ['tier', 'TIER_OVERRIDE_MARKER'],
    ['verify', 'VERIFY_OVERRIDE_MARKER'],
    ['check', 'CHECK_OVERRIDE_MARKER'],
  ]) {
    const own = prompts.filter((prompt) => prompt.startsWith(`Task: ${stage}`));
    expect(own.length).toBeGreaterThan(0);
    for (const prompt of own) {
      expect(prompt).toContain(marker);
      expect(prompt).toContain('EXISTING_COMPONENT_MARKER');
    }
  }
  const reopened = api.openPipelineDb();
  try {
    expect(api.loadComponentReviewMetadata(reopened, sessionId, 'Panel')?.exploration?.detail?.recordOnly).toBe(true);
  } finally {
    reopened.close();
  }
});

it('rejects a missing detail prompt path before stage dispatch while retaining accepted component records', async () => {
  const { sessionId, decisions, request } = await seed();
  await api.runExplorationComponentsSession(request);
  const db = api.openPipelineDb();
  api.applyScopeDecisions(db, sessionId, decisions);
  db.close();
  const invoke = vi.fn(request.invoker.invoke);
  const result = await api.runExplorationDetailSession({
    ...request,
    promptOverrides: [`detail=${join(directory, 'missing.md')}`],
    invoker: { invoke },
  });
  expect(result.ok).toBe(false);
  expect(invoke).not.toHaveBeenCalled();
  const reopened = api.openPipelineDb();
  try {
    expect(api.loadAcceptedSlotDecisions(reopened, sessionId)?.some((slot) => slot.state === 'finite')).toBe(true);
    expect(api.loadExplorationRun(reopened, sessionId, 'detail')?.status).toBe('failed');
  } finally {
    reopened.close();
  }
});

it('keeps independently accepted parent-child edges in two named slots through cold gate, generation and export', async () => {
  const { sessionId, decisions, request } = await seed(['renderBody', 'accessory']);
  expect((await api.runExplorationComponentsSession(request)).ok).toBe(true);
  let db = api.openPipelineDb();
  try {
    expect(api.loadScopeComponents(db, sessionId).find((component) => component.name === 'Panel')?.slots).toEqual([
      { name: 'accessory', allowedComponents: ['Text'] },
      { name: 'renderBody', allowedComponents: ['Text'] },
    ]);
    api.applyScopeDecisions(db, sessionId, decisions);
  } finally {
    db.close();
  }
  expect((await api.runExplorationDetailSession(request)).ok).toBe(true);
  const generatedResult = await api.runGenerateComponentsSession({
    sessionId,
    agent: 'codex',
    promptOverrides: ['generate=Classify accepted source.'],
    noCache: true,
  });
  expect(generatedResult.allOk).toBe(true);
  db = api.openPipelineDb();
  try {
    const panel = api.loadCDFComponents(db, sessionId).find((entry) => entry.key === 'Panel');
    expect(panel?.entry.$slots).toEqual({
      accessory: { $allowedComponents: ['Text'] },
      renderBody: { $allowedComponents: ['Text'] },
    });
  } finally {
    db.close();
  }
});
