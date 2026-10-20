import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  captureSourceEvidence,
  extractReactComponents as extractPublic,
  readInputOutput,
} from '@contentful/experience-design-system-extraction';
import { extractReactComponents } from '../../steps/extraction/src/framework-adapters/react/extract-react-components.js';
import { readComponentFacts } from '../src/session/repositories/component-facts-validation.js';
import { buildCompilerEvidenceInline } from '../../agents/prompts/helpers/build-compiler-evidence-inline.js';
import * as api from '../../index.js';
import { beginExplorationRun, publishExplorationRun } from '../src/session/repositories/exploration/records.js';
import type { SourceInputAssociation, SlotDecision } from '@contentful/experience-design-system-types';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../agents/invoker/create-local-cli-agent-invoker.js', () => ({
  createLocalCliAgentInvoker: () => ({ invoke, checkAuth: async () => 'ok' }),
}));
vi.mock('../../analytics/index.js', () => ({ bindAnalyticsSessionId: async () => undefined }));
const directories: string[] = [];
afterEach(() => {
  directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
  invoke.mockReset();
});
async function fixture(finite = false, observationLimits?: { maxObservations: number }) {
  const root = mkdtempSync(join(tmpdir(), 'saved-input-output-'));
  directories.push(root);
  const path = join(root, 'Surface.tsx');
  const caller = join(root, 'Caller.test.tsx');
  writeFileSync(
    caller,
    `import {Surface} from './Surface';const sighting=()=> <Surface supplied="observed" label="sample"/>;`,
  );
  writeFileSync(
    path,
    `export function Surface(props: { supplied: ${finite ? "'Child'" : 'string'}; label?: string; opaque?: unknown }) { return <section>{props.supplied}</section>; } ${finite ? 'export function Child() { return <b/>; }' : ''}`,
  );
  const backend = await extractReactComponents([path], undefined, {
    projectRoot: root,
    componentObservationLimits: observationLimits,
    evidenceFilePaths: [caller],
  });
  const library = await extractPublic([path], undefined, {
    projectRoot: root,
    componentObservationLimits: observationLimits,
    evidenceFilePaths: [caller],
  });
  expect(backend.components[0]!.componentFacts!.sourceObservations!.inputOutput).toEqual(
    library.components[0]!.componentFacts!.sourceObservations!.inputOutput,
  );
  const dbPath = join(root, 'pipeline.db');
  const db = api.openPipelineDb(dbPath);
  const { sessionId } = api.getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  const stepId = api.createStep(db, sessionId, 'analyze extract', {});
  const capture = await captureSourceEvidence({
    projectRoot: root,
    filePaths: [path],
    evidenceFilePaths: [caller],
    inventory: backend.sourceInventory,
    compilerSources: backend.compilerSources,
  });
  const handle = api.completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId,
    components: backend.components,
    cycles: [],
    scannedFiles: [path],
    capture,
    observations: { accepted: [], rejected: [] },
  });
  const saved = api.loadRawComponents(db, sessionId).find((component) => component.name === 'Surface')!;
  const flow = saved.componentFacts!.sourceObservations!.inputOutput!;
  expect(readComponentFacts(saved.componentFacts).status).toBe('available');
  const input = flow.inputs.find((input) => input.name === 'supplied')!;
  const association: SourceInputAssociation = {
    schemaVersion: 1,
    componentId: saved.component_id,
    componentDeclarationId: flow.componentDeclarationId,
    rootSymbolId: input.rootSymbolId,
    inputName: input.name,
    inputPath: input.inputPath,
  };
  const decision: SlotDecision = {
    name: saved.name,
    source: saved.source,
    componentId: saved.component_id,
    slot: 'region',
    state: 'open',
    allowedComponents: [],
    evidence: [],
    coverage: 7,
    realVotes: 7,
    sourceInput: association,
  };
  db.close();
  return { root, dbPath, sessionId, handle, saved, flow, association, decision };
}
it('publishes exact associations from mounted default extraction and exploration, then preserves complete edits on reopen/export', async () => {
  const f = await fixture();
  const prompts: string[] = [];
  const invoker = {
    invoke: async ({ prompt }: { prompt: string }) => {
      prompts.push(prompt);
      const scope = /"scope":"([^"]+)"/.exec(prompt)![1]!;
      return {
        stdout: JSON.stringify({
          agentRole: scope,
          components: [
            {
              name: f.saved.name,
              source: f.saved.source,
              componentId: f.saved.component_id,
              included: true,
              slots: [
                {
                  name: 'region',
                  isRealSlot: true,
                  sourceInput: f.association,
                  evidence: ['Declared source input reaches returned content.'],
                },
              ],
            },
          ],
        }),
        stderr: '',
        exitCode: 0,
        timedOut: false,
      };
    },
  };
  const result = await api.runExplorationComponentsSession({
    dbPath: f.dbPath,
    sessionId: f.sessionId,
    sourceEvidenceHandle: f.handle,
    agent: 'codex',
    invoker,
    backoffMs: 0,
    rendererReference: { kind: 'text', text: 'Inputs remain broad.', origin: 'fixture' },
  });
  expect(result.ok).toBe(true);
  expect(prompts).toHaveLength(7);
  expect(prompts.some((prompt) => prompt.includes('referenceIndexes'))).toBe(true);
  expect(prompts.some((prompt) => prompt.includes('incoming-caller-coverage-open'))).toBe(true);
  expect(prompts.filter((prompt) => prompt.includes('"inputOutput":'))).toHaveLength(5);
  let db = api.openPipelineDb(f.dbPath);
  expect(api.loadAcceptedSlotDecisions(db, f.sessionId)?.[0]?.sourceInput).toEqual(f.association);
  api.applyScopeDecisions(db, f.sessionId, { accepted: ['Surface'], rejected: [] });
  const accepted = api.loadAcceptedSlotDecisions(db, f.sessionId)!;
  const storedComponents = api.loadRawComponents(db, f.sessionId);
  db.close();
  const detail = await api.runExplorationDetailSession({
    dbPath: f.dbPath,
    sessionId: f.sessionId,
    sourceEvidenceHandle: f.handle,
    agent: 'codex',
    invoker,
    backoffMs: 0,
    selectedNames: ['Surface'],
    rendererReference: { kind: 'text', text: 'Inputs remain broad.', origin: 'fixture' },
  });
  expect(detail.ok).toBe(true);
  invoke.mockResolvedValue({
    stdout: [
      { tool: 'classify_component', description: 'Source surface' },
      { tool: 'classify_prop', prop: 'supplied', cdf_type: 'string', cdf_category: 'content' },
      { tool: 'classify_prop', prop: 'label', cdf_type: 'string', cdf_category: 'content' },
    ]
      .map((call) => JSON.stringify(call))
      .join('\n'),
    stderr: '',
    exitCode: 0,
    timedOut: false,
  });
  const oldPath = process.env.EDS_PIPELINE_DB_PATH;
  process.env.EDS_PIPELINE_DB_PATH = f.dbPath;
  try {
    const generated = await api.runGenerateComponentsSession({
      sessionId: f.sessionId,
      agent: 'codex',
      promptOverrides: ['generate=text:Classify the supplied source.'],
      noCache: true,
    });
    expect(generated.allOk).toBe(true);
    expect(invoke.mock.calls.at(-1)![0].prompt).toContain('"inputOutput":');
    expect(invoke.mock.calls.at(-1)![0].prompt).toContain('"sourceInput":');
    expect(invoke.mock.calls.at(-1)![0].prompt).toContain('"referenceIndex":');
  } finally {
    if (oldPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = oldPath;
  }
  const stateless = await api.generateCdfComponents({
    components: storedComponents,
    acceptedSlots: accepted,
    agent: 'codex',
    skillContentOverride: 'Classify the supplied source.',
  });
  expect(stateless.failures).toEqual([]);
  expect(stateless.components[0]?.$properties).not.toHaveProperty('supplied');
  expect(stateless.components[0]?.$slots?.region?.$sourceInput).toEqual(f.association);
  expect(invoke.mock.calls.at(-1)![0].prompt).toContain('"sourceInput":');
  db = api.openPipelineDb(f.dbPath);
  api.applyToolCalls(
    db,
    f.sessionId,
    f.saved.component_id,
    'Surface',
    [{ tool: 'classify_prop', prop: 'label', cdf_type: 'string', cdf_category: 'content' }],
    [],
  );
  const entry = api.loadCDFComponents(db, f.sessionId)[0]!.entry;
  expect(entry.$slots?.region?.$sourceInput).toEqual(f.association);
  api.storeCDFComponents(db, f.sessionId, [
    {
      key: 'Surface',
      entry: {
        ...entry,
        $description: 'Edited surface',
        $properties: { label: { $type: 'string', $category: 'content', $default: 'edited', $required: false } },
        $slots: { renamed: { ...entry.$slots!.region, $description: 'Edited region', $required: true } },
      },
    },
  ]);
  db.close();
  db = api.openPipelineDb(f.dbPath);
  try {
    const reopened = api.loadCDFComponents(db, f.sessionId)[0]!.entry;
    expect(reopened.$slots?.renamed).toEqual({
      $sourceInput: f.association,
      $description: 'Edited region',
      $required: true,
    });
    expect(reopened.$slots).not.toHaveProperty('region');
    expect(reopened.$properties.label?.$default).toBe('edited');
    expect(api.loadRawComponents(db, f.sessionId)[0]!.sourceCandidates?.map((candidate) => candidate.name)).toContain(
      'supplied',
    );
    const channel = JSON.parse(
      buildCompilerEvidenceInline(api.loadRawComponents(db, f.sessionId), { readiness: 'ready' }),
    );
    expect(channel.componentFacts[0].facts.sourceObservations.inputOutput.inputs[0].declaration.binding).toBe(
      'verified',
    );
    const previousPath = process.env.EDS_PIPELINE_DB_PATH;
    process.env.EDS_PIPELINE_DB_PATH = f.dbPath;
    try {
      const exported = await api.exportCdfDocument({ sessionId: f.sessionId });
      expect((exported.cdf.Surface as { $slots: Record<string, unknown> }).$slots.renamed).toEqual(
        reopened.$slots!.renamed,
      );
    } finally {
      if (previousPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
      else process.env.EDS_PIPELINE_DB_PATH = previousPath;
    }
    api.storeCDFComponents(db, f.sessionId, [{ key: 'Surface', entry: { ...reopened, $slots: {} } }]);
    expect(api.loadCDFComponents(db, f.sessionId)[0]!.entry.$slots).toBeUndefined();
    expect(
      api
        .loadAcceptedSlotDecisions(db, f.sessionId)
        ?.filter((decision) => decision.state === 'open' || decision.state === 'finite'),
    ).toEqual([]);
  } finally {
    db.close();
  }
});
it('stateless generation rejects nonexistent accepted owners before producing a successful definition', async () => {
  const f = await fixture();
  const invalid = { ...f.decision, sourceInput: { ...f.association, rootSymbolId: 'different' } };
  invoke.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false });
  const result = await api.generateCdfComponents({
    components: [f.saved],
    acceptedSlots: [invalid],
    skillContentOverride: 'Classify source.',
  });
  expect(result.components).toEqual([]);
  expect(result.failures).toHaveLength(1);
  expect(invoke).not.toHaveBeenCalled();
});
it.each(['wrong-component', 'missing-input', 'wrong-root', 'duplicate', 'blank'])(
  'rejects invalid accepted ownership before publishing: %s',
  async (mode) => {
    const f = await fixture();
    const db = api.openPipelineDb(f.dbPath);
    try {
      const source = api.loadCompletedSourceEvidence(db, f.sessionId, f.handle);
      expect(source.readiness).toBe('ready');
      if (source.readiness !== 'ready') throw new Error('source unavailable');
      const run = beginExplorationRun(db, {
        sessionId: f.sessionId,
        envelopeId: source.envelope.envelopeId,
        digest: source.envelope.digest,
        phase: 'components',
      });
      const invalid = structuredClone(f.decision);
      if (mode === 'wrong-component') invalid.sourceInput!.componentId = 'other';
      if (mode === 'missing-input') {
        invalid.sourceInput!.inputName = 'absent';
        invalid.sourceInput!.inputPath = ['absent'];
      }
      if (mode === 'wrong-root') invalid.sourceInput!.rootSymbolId = 'other';
      if (mode === 'blank') invalid.slot = '  ';
      expect(() =>
        publishExplorationRun(db, run.runId, {
          inclusion: [],
          slots: mode === 'duplicate' ? [invalid, { ...invalid, slot: 'other' }] : [invalid],
        }),
      ).toThrow(/input|owner|name/i);
      expect(api.loadExplorationRun(db, f.sessionId, 'components')?.status).toBe('pending');
    } finally {
      db.close();
    }
  },
);
it('rejects conflicting complete CDF edits atomically and keeps the accepted saved state', async () => {
  const f = await fixture();
  const db = api.openPipelineDb(f.dbPath);
  try {
    const source = api.loadCompletedSourceEvidence(db, f.sessionId, f.handle);
    if (source.readiness !== 'ready') throw new Error('source unavailable');
    const run = beginExplorationRun(db, {
      sessionId: f.sessionId,
      envelopeId: source.envelope.envelopeId,
      digest: source.envelope.digest,
      phase: 'components',
    });
    publishExplorationRun(db, run.runId, { inclusion: [], slots: [f.decision] });
    const before = api.loadCDFComponents(db, f.sessionId);
    expect(() =>
      api.storeCDFComponents(db, f.sessionId, [
        {
          key: 'Surface',
          entry: {
            $type: 'component',
            $description: 'must not save',
            $properties: { supplied: { $type: 'richtext', $category: 'content' } },
            $slots: { region: { $sourceInput: f.association } },
          },
        },
      ]),
    ).toThrow(/input|owner|conflict/i);
    expect(api.loadCDFComponents(db, f.sessionId)).toEqual(before);
  } finally {
    db.close();
  }
});
it('strictly rejects altered source identities, unknown versions and fabricated witness membership', async () => {
  const f = await fixture();
  expect(readInputOutput(f.flow).status).toBe('available');
  expect(readInputOutput({ ...f.flow, schemaVersion: 99 }).status).toBe('unsupported');
  const invalid = structuredClone(f.flow);
  invalid.summaries[0]!.witnessIds = ['fabricated'];
  expect(readInputOutput(invalid).status).toBe('corrupt');
  expect(
    readComponentFacts({
      ...f.saved.componentFacts,
      sourceObservations: {
        ...f.saved.componentFacts!.sourceObservations,
        inputOutput: { ...f.flow, componentDeclarationId: 'different' },
      },
    }).status,
  ).toBe('corrupt');
});
it('keeps mapped internal markup separate from supplied-input slots in both default fronts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mapped-input-output-'));
  directories.push(root);
  const path = join(root, 'Surface.tsx');
  const caller = join(root, 'Caller.test.tsx');
  writeFileSync(
    caller,
    `import {Surface} from './Surface';const sighting=()=> <Surface supplied="observed" label="sample"/>;`,
  );
  writeFileSync(
    path,
    `export function Item(props: { label: string }) { return <span>{props.label}</span>; }
export function Surface({ rows }: { rows: string[] }) { return <section>{rows.map((label) => <Item label={label} />)}</section>; }`,
  );
  for (const extractor of [extractReactComponents, extractPublic]) {
    const component = (await extractor([path], undefined, { projectRoot: root })).components.find(
      (item) => item.name === 'Surface',
    )!;
    expect(component.slots).toEqual([]);
    expect(component.sourceCandidates?.map((candidate) => candidate.name)).toContain('rows');
  }
});
it.each(['hash', 'range'])(
  'downgrades stale saved flow locations rather than accepting fabricated binding: %s',
  async (mode) => {
    const f = await fixture();
    const db = api.openPipelineDb(f.dbPath);
    try {
      const invalid = structuredClone(f.saved.componentFacts!);
      const location = invalid.sourceObservations!.inputOutput!.inputs.find(
        (input) => input.name === 'supplied',
      )!.declaration;
      if (mode === 'hash') location.textHash = 'different';
      else {
        location.startOffset = 100000;
        location.endOffset = 100100;
      }
      db.prepare('UPDATE raw_component_source_evidence SET component_facts_json = ? WHERE session_id = ?').run(
        JSON.stringify(invalid),
        f.sessionId,
      );
      const saved = api.loadRawComponents(db, f.sessionId)[0]!;
      const declaration = saved.componentFacts!.sourceObservations!.inputOutput!.inputs.find(
        (input) => input.name === 'supplied',
      )!.declaration;
      expect(declaration.binding).not.toBe('verified');
      expect(saved.sourceCandidates?.map((candidate) => candidate.name)).toContain('supplied');
    } finally {
      db.close();
    }
  },
);

it('checks renamed slot restrictions against the original source input instead of the authoring name', async () => {
  const f = await fixture();
  let checks = 0;
  const invoker = {
    invoke: async ({ prompt }: { prompt: string }) => {
      const assignment = JSON.parse(prompt.split('\nAssignment:\n')[1]!.split('\n')[0]!);
      const input = JSON.parse(prompt.split('\nInput data:\n')[1]!.split('\n')[0]!);
      let output: unknown;
      if (assignment.scope)
        output = {
          agentRole: assignment.scope,
          components: [
            {
              name: f.saved.name,
              source: f.saved.source,
              componentId: f.saved.component_id,
              included: true,
              slots: [
                {
                  name: 'region',
                  isRealSlot: true,
                  sourceInput: f.association,
                  evidence: ['Source input output.'],
                  allowedComponents: ['Surface'],
                  restriction: {
                    kind: 'declared',
                    applicable: true,
                    evidence: [{ source: f.saved.source, line: '1', quote: 'supplied: string' }],
                  },
                },
              ],
            },
          ],
        };
      else {
        checks++;
        output = {
          checks: input.entries.map((entry: { checkId: string; itemId: string }) => ({
            checkId: entry.checkId,
            itemId: entry.itemId,
            component: input.component,
            source: input.source,
            verdict: 'supports',
            reason: 'Fixture support.',
          })),
        };
      }
      return { stdout: JSON.stringify(output), stderr: '', exitCode: 0, timedOut: false };
    },
  };
  const result = await api.runExplorationComponentsSession({
    dbPath: f.dbPath,
    sessionId: f.sessionId,
    sourceEvidenceHandle: f.handle,
    agent: 'codex',
    invoker,
    backoffMs: 0,
    rendererReference: { kind: 'text', text: 'Broad source input.', origin: 'fixture' },
  });
  if (!result.ok) throw new Error(JSON.stringify(result));
  expect(result.ok).toBe(true);
  expect(checks).toBe(0);
  const db = api.openPipelineDb(f.dbPath);
  try {
    const decision = api.loadAcceptedSlotDecisions(db, f.sessionId)!.find((decision) => decision.slot === 'region')!;
    expect(decision.state).toBe('open');
    expect(decision.required).toBe(true);
  } finally {
    db.close();
  }
});

it.each(['supports', 'does-not-support'])(
  'binds independent finite support to the renamed source-input/output route: %s',
  async (verdict) => {
    const f = await fixture(true);
    let checks = 0;
    const invoker = {
      invoke: async ({ prompt }: { prompt: string }) => {
        const assignment = JSON.parse(prompt.split('\nAssignment:\n')[1]!.split('\n')[0]!);
        const input = JSON.parse(prompt.split('\nInput data:\n')[1]!.split('\n')[0]!);
        let output: unknown;
        if (assignment.scope)
          output = {
            agentRole: assignment.scope,
            components: input.components.map((component: { name: string; source: string; component_id: string }) => ({
              name: component.name,
              source: component.source,
              componentId: component.component_id,
              included: true,
              slots:
                component.name === 'Surface'
                  ? [
                      {
                        name: 'region',
                        isRealSlot: true,
                        sourceInput: f.association,
                        evidence: ['Declared input returned.'],
                        allowedComponents: ['Child'],
                        restriction: {
                          kind: 'declared',
                          applicable: true,
                          evidence: [
                            {
                              source: input.sourceInput.files.find((file: { path: string }) =>
                                file.path.endsWith('/Surface.tsx'),
                              ).path,
                              line: '1',
                              quote: "supplied: 'Child'",
                            },
                          ],
                        },
                      },
                    ]
                  : [],
            })),
          };
        else {
          checks++;
          expect(input.entries[0].hypothesis).toContain('"inputName":"supplied"');
          expect(prompt).toContain('bounded-source-dependencies');
          output = {
            checks: input.entries.map((entry: { checkId: string; itemId: string }) => ({
              checkId: entry.checkId,
              itemId: entry.itemId,
              component: input.component,
              source: input.source,
              verdict,
              reason: 'Independent fixture applicability decision.',
            })),
          };
        }
        return { stdout: JSON.stringify(output), stderr: '', exitCode: 0, timedOut: false };
      },
    };
    const result = await api.runExplorationComponentsSession({
      dbPath: f.dbPath,
      sessionId: f.sessionId,
      sourceEvidenceHandle: f.handle,
      agent: 'codex',
      invoker,
      backoffMs: 0,
      rendererReference: { kind: 'text', text: 'Source restriction.', origin: 'fixture' },
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(checks).toBe(1);
    const db = api.openPipelineDb(f.dbPath);
    try {
      const decision = api.loadAcceptedSlotDecisions(db, f.sessionId)!.find((decision) => decision.slot === 'region')!;
      expect(decision.state).toBe(verdict === 'supports' ? 'finite' : 'unresolved');
      expect(decision.allowedComponents).toEqual(verdict === 'supports' ? ['Child'] : []);
      expect(decision.sourceInput).toEqual(f.association);
    } finally {
      db.close();
    }
  },
);

it('rejects a closed negative summary that drops existing returned witnesses', async () => {
  const f = await fixture();
  const invalid = structuredClone(f.flow);
  const summary = invalid.summaries.find((item) => item.inputName === 'supplied')!;
  summary.state = 'absent';
  summary.witnessIds = [];
  summary.reasons = [];
  expect(readInputOutput(invalid).status).toBe('corrupt');
});
it.each(['input-name', 'root-identity', 'missing-root-evidence'])(
  'rejects a saved owner backed by fabricated consistent flow labels: %s',
  async (mode) => {
    const f = await fixture(false, mode === 'missing-root-evidence' ? { maxObservations: 1 } : undefined);
    const db = api.openPipelineDb(f.dbPath);
    try {
      const facts = structuredClone(f.saved.componentFacts!);
      const flow = facts.sourceObservations!.inputOutput!;
      const input = flow.inputs.find((item) => item.name === 'supplied')!;
      const association = structuredClone(f.association);
      if (mode === 'input-name') {
        input.name = 'fabricated';
        input.inputPath = ['fabricated'];
        association.inputName = 'fabricated';
        association.inputPath = ['fabricated'];
        for (const summary of flow.summaries) if (summary.inputName === 'supplied') summary.inputName = 'fabricated';
        for (const witness of flow.witnesses)
          if (witness.inputName === 'supplied') {
            witness.inputName = 'fabricated';
            witness.inputPath = ['fabricated', ...witness.inputPath.slice(1)];
          }
      } else {
        input.rootSymbolId = 'fabricated';
        association.rootSymbolId = 'fabricated';
        for (const witness of flow.witnesses) if (witness.inputName === 'supplied') witness.rootSymbolId = 'fabricated';
      }
      db.prepare(
        'UPDATE raw_component_source_evidence SET component_facts_json=? WHERE session_id=? AND component_id=?',
      ).run(JSON.stringify(facts), f.sessionId, f.saved.component_id);
      const source = api.loadCompletedSourceEvidence(db, f.sessionId, f.handle);
      if (source.readiness !== 'ready') throw new Error('source unavailable');
      const run = beginExplorationRun(db, {
        sessionId: f.sessionId,
        envelopeId: source.envelope.envelopeId,
        digest: source.envelope.digest,
        phase: 'components',
      });
      expect(() =>
        publishExplorationRun(db, run.runId, { inclusion: [], slots: [{ ...f.decision, sourceInput: association }] }),
      ).toThrow(/input|identity|owner/i);
      expect(api.loadExplorationRun(db, f.sessionId, 'components')?.status).toBe('pending');
    } finally {
      db.close();
    }
  },
);
