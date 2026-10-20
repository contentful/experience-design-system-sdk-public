import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  captureSourceEvidence,
  extractReactComponents as extractPublic,
} from '@contentful/experience-design-system-extraction';
import { extractReactComponents } from '../../steps/extraction/src/framework-adapters/react/extract-react-components.js';
import { buildCompilerEvidenceInline } from '../../agents/prompts/helpers/build-compiler-evidence-inline.js';
import { readComponentFacts } from '../src/session/repositories/component-facts-validation.js';
import {
  openPipelineDb,
  getOrCreateSession,
  createStep,
  completeExtractionWithSourceEvidence,
  loadRawComponents,
  loadCompletedSourceEvidence,
  loadComponentReviewMetadata,
} from '../src/session/repositories/db.js';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../agents/invoker/create-local-cli-agent-invoker.js', () => ({
  createLocalCliAgentInvoker: () => ({ invoke, checkAuth: async () => 'ok' }),
}));
vi.mock('../../analytics/index.js', () => ({ bindAnalyticsSessionId: async () => undefined }));
import { runSelectionService } from '../../steps/selection/src/services/run-selection-service.js';
import { runGenerateComponentsSession } from '../../orchestrators/run-generate-components-session/run-generate-components-session.js';
import { applyScopeDecisions } from '../src/session/repositories/db.js';
const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
it('connects both real producers to strict saved evidence, reopen, review and compiler prompts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'saved-source-closure-'));
  directories.push(root);
  const path = join(root, 'Panel.tsx');
  writeFileSync(
    path,
    `function leaf(value: string) { return value; }
export function Panel(props: { mode: 'short' | 'long' }) { return <div>{leaf(props.mode)}</div>; }
export function Empty() { return <span />; }`,
  );
  const backend = await extractReactComponents([path], undefined, { projectRoot: root });
  const library = await extractPublic([path], undefined, { projectRoot: root });
  for (const component of backend.components) {
    expect(component.componentFacts).toHaveProperty('sourceClosure');
    expect(component.componentFacts!.sourceClosure).toEqual(
      library.components.find((item) => item.name === component.name)!.componentFacts!.sourceClosure,
    );
    expect(readComponentFacts(component.componentFacts).status).toBe('available');
  }
  const dbPath = join(root, 'pipeline.db');
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  const stepId = createStep(db, sessionId, 'analyze extract', {});
  const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
  const handle = completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId,
    components: backend.components,
    cycles: [],
    scannedFiles: ['Panel.tsx'],
    capture,
    observations: { accepted: [], rejected: [] },
  });
  db.close();
  const reopened = openPipelineDb(dbPath);
  try {
    expect(loadCompletedSourceEvidence(reopened, sessionId, handle).readiness).toBe('ready');
    const saved = loadRawComponents(reopened, sessionId);
    expect(saved[0]!.componentFacts!.sourceClosure!.nodes[0]!.location.binding).toBe('verified');
    expect(saved[0]!.componentFacts!.sourceClosure!.captureBinding).toMatchObject({
      sessionId,
      extractionStepId: stepId,
      envelopeId: handle.envelopeId,
      envelopeDigest: handle.digest,
      captureId: capture.captureId,
      captureDigest: capture.digest,
    });
    expect(loadComponentReviewMetadata(reopened, sessionId, 'Panel')?.componentFacts?.sourceClosure).toBeDefined();
    const prompt = JSON.parse(buildCompilerEvidenceInline(saved, { readiness: 'ready' }));
    expect(prompt.componentFacts[0].facts.sourceClosure.schemaVersion).toBe(1);
    expect(prompt.componentFacts[0].facts.sourceClosure.summaries.length).toBeGreaterThan(0);
    expect(
      JSON.parse(
        buildCompilerEvidenceInline(saved, { readiness: 'unavailable', reason: 'source-unavailable' }),
      ).componentFacts.every((item: { facts: unknown }) => item.facts === null),
    ).toBe(true);
  } finally {
    reopened.close();
  }
});

it('downgrades saved closure with a different envelope identity while preserving raw domains and source observations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'saved-closure-identity-'));
  directories.push(root);
  const path = join(root, 'Panel.tsx');
  writeFileSync(path, `export function Panel(props: { mode: 'a' | 'b' }) { return <div>{props.mode}</div>; }`);
  const result = await extractReactComponents([path], undefined, { projectRoot: root });
  const db = openPipelineDb(join(root, 'pipeline.db'));
  try {
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    const stepId = createStep(db, sessionId, 'analyze extract', {});
    const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
    completeExtractionWithSourceEvidence(db, {
      sessionId,
      stepId,
      components: result.components,
      cycles: [],
      scannedFiles: ['Panel.tsx'],
      capture,
      observations: { accepted: [], rejected: [] },
    });
    const saved = loadRawComponents(db, sessionId)[0]!;
    const facts = structuredClone(saved.componentFacts!);
    expect(facts.sourceClosure!.captureBinding).toBeDefined();
    for (const field of [
      'captureId',
      'captureDigest',
      'envelopeId',
      'envelopeDigest',
      'sessionId',
      'extractionStepId',
    ] as const) {
      const mutated = structuredClone(facts);
      const binding = mutated.sourceClosure!.captureBinding!;
      if (field === 'extractionStepId') binding.extractionStepId += 1;
      else binding[field] = 'different-identity';
      db.prepare('UPDATE raw_component_source_evidence SET component_facts_json = ? WHERE session_id = ?').run(
        JSON.stringify(mutated),
        sessionId,
      );
      const changed = loadRawComponents(db, sessionId)[0]!;
      expect(changed.componentFacts!.sourceClosure).toMatchObject({
        status: 'unavailable',
        binding: 'unavailable',
        reason: 'capture-envelope-mismatch',
      });
      expect(changed.componentFacts!.sourceObservations).toBeDefined();
      expect(changed.sourceCandidates?.find((item) => item.name === 'mode')?.facts?.domain.openness).toBe('closed');
    }
  } finally {
    db.close();
  }
});

it('delivers reopened evidence to actual selection and generation prompts and preserves human reasons', async () => {
  const root = mkdtempSync(join(tmpdir(), 'saved-closure-prompts-'));
  directories.push(root);
  const path = join(root, 'Panel.tsx');
  writeFileSync(
    path,
    `function leaf(value: string) { return value; } export function Panel(props: { mode: 'a' | 'b' }) { return <div>{leaf(props.mode)}</div>; }`,
  );
  const result = await extractReactComponents([path], undefined, { projectRoot: root });
  const dbPath = join(root, 'pipeline.db');
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  const stepId = createStep(db, sessionId, 'analyze extract', {});
  const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
  completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId,
    components: result.components,
    cycles: [],
    scannedFiles: ['Panel.tsx'],
    capture,
    observations: { accepted: [], rejected: [] },
  });
  applyScopeDecisions(db, sessionId, { accepted: ['Panel'], rejected: [] });
  db.close();
  const reopened = openPipelineDb(dbPath);
  const saved = loadRawComponents(reopened, sessionId);
  reopened.close();
  invoke.mockResolvedValueOnce({
    stdout: JSON.stringify({ tool: 'select_component', name: 'Panel', reason: 'visible content' }),
    stderr: '',
    exitCode: 0,
    timedOut: false,
  });
  await runSelectionService({
    components: saved,
    agent: 'codex',
    promptText: 'Select from source.',
    compilerEvidenceInline: buildCompilerEvidenceInline(saved, { readiness: 'ready' }),
  });
  expect(invoke.mock.calls.at(-1)![0].prompt).toContain('"sourceClosure":');
  expect(invoke.mock.calls.at(-1)![0].prompt).toContain(capture.captureId);
  invoke.mockResolvedValue({
    stdout: JSON.stringify({ tool: 'classify_prop', prop: 'mode', cdf_type: 'string', cdf_category: 'content' }),
    stderr: '',
    exitCode: 0,
    timedOut: false,
  });
  const previousDbPath = process.env.EDS_PIPELINE_DB_PATH;
  process.env.EDS_PIPELINE_DB_PATH = dbPath;
  try {
    const generated = await runGenerateComponentsSession({
      sessionId,
      agent: 'codex',
      promptOverrides: ['generate=Generate from the supplied source.'],
      noCache: true,
    });
    expect(generated.allOk).toBe(true);
    const prompt = invoke.mock.calls.at(-1)![0].prompt;
    expect(prompt).toContain('"sourceClosure":');
    expect(prompt).toContain(capture.captureId);
    expect(prompt).toContain('"semantics":"lexical-source"');
    expect(prompt).toContain('leaf(value: string)');
    const broken = openPipelineDb(dbPath);
    broken.prepare("UPDATE steps SET status = 'error' WHERE id = ?").run(stepId);
    const unavailable = loadRawComponents(broken, sessionId);
    expect(unavailable[0]!.componentFacts!.sourceClosure).toMatchObject({
      status: 'unavailable',
      reason: 'completed-extraction-step-unavailable',
    });
    broken.close();
    await runSelectionService({
      components: unavailable,
      agent: 'codex',
      promptText: 'Select with unavailable source.',
      compilerEvidenceInline: buildCompilerEvidenceInline(unavailable, {
        readiness: 'unavailable',
        reason: 'completed-extraction-step-unavailable',
      }),
    });
    expect(invoke.mock.calls.at(-1)![0].prompt).toContain('"facts":null');
    await runGenerateComponentsSession({
      sessionId,
      agent: 'codex',
      promptOverrides: ['generate=Generate with explicit unavailable evidence.'],
      noCache: true,
    });
    const unavailablePrompt = invoke.mock.calls.at(-1)![0].prompt;
    expect(unavailablePrompt).toContain('"readiness":"unavailable"');
    expect(unavailablePrompt).toContain('"facts":null');
    expect(unavailablePrompt).toContain('completed-extraction-step-unavailable');
    expect(unavailablePrompt).not.toContain('"sourceClosure":');
  } finally {
    if (previousDbPath === undefined) delete process.env.EDS_PIPELINE_DB_PATH;
    else process.env.EDS_PIPELINE_DB_PATH = previousDbPath;
  }
});

it('rejects fabricated lexical facts and unsupported versions in the backend strict sidecar guard', async () => {
  const root = mkdtempSync(join(tmpdir(), 'closure-strict-sidecar-'));
  directories.push(root);
  const path = join(root, 'Panel.tsx');
  writeFileSync(path, `export function Panel() { return <div />; }`);
  const component = (await extractReactComponents([path], undefined, { projectRoot: root })).components[0]!;
  expect(readComponentFacts(component.componentFacts).status).toBe('available');
  const fabricated = structuredClone(component.componentFacts!);
  const previous = fabricated.sourceClosure!.nodes[0]!.observationIds[0]!;
  fabricated.sourceClosure!.nodes[0]!.observationIds[0] = 'fabricated';
  for (const summary of fabricated.sourceClosure!.summaries)
    for (const fact of summary.facts) if (fact.observationId === previous) fact.observationId = 'fabricated';
  expect(readComponentFacts(fabricated).status).toBe('corrupt');
  const unsupported = structuredClone(component.componentFacts!);
  unsupported.sourceClosure!.schemaVersion = 99 as never;
  expect(readComponentFacts(unsupported).status).toBe('unsupported');
  expect(
    readComponentFacts({ ...component.componentFacts, sourceClosure: { schemaVersion: 1, compilerNode: new Date() } })
      .status,
  ).toBe('corrupt');
});

it('retains distinct same-named reachable declarations outside selection with deterministic single-read receipts on both fronts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'source-closure-identities-'));
  directories.push(root);
  writeFileSync(join(root, 'Left.ts'), `export function read(value: string) { return value; }`);
  writeFileSync(join(root, 'Right.ts'), `export function read(value: string) { return value.toUpperCase(); }`);
  const path = join(root, 'Panel.tsx');
  writeFileSync(
    path,
    `import { read as left } from './Left.js'; import { read as right } from './Right.js'; export function Panel(props: { label: string }) { left(props.label); left(props.label); return <div>{right(props.label)}</div>; }`,
  );
  for (const front of [extractPublic, extractReactComponents]) {
    const first = (await front([path, path], undefined, { projectRoot: root })).components[0]!;
    const second = (await front([path], undefined, { projectRoot: root })).components[0]!;
    const evidence = first.componentFacts!.sourceClosure!;
    expect(evidence).toEqual(second.componentFacts!.sourceClosure);
    expect(evidence.nodes.filter((node) => /(?:Left|Right)\.ts$/.test(node.location.canonicalPath!))).toHaveLength(2);
    expect(new Set(evidence.reads.map((read) => read.nodeId)).size).toBe(evidence.reads.length);
    const rootSummary = evidence.summaries.find((summary) => summary.nodeId === evidence.rootId)!;
    expect(new Set(rootSummary.facts.map((fact) => fact.ownerId)).size).toBeGreaterThanOrEqual(3);
    expect(rootSummary.facts.some((fact) => fact.ownerId !== evidence.rootId && fact.strength === 'inferred')).toBe(
      true,
    );
  }
});
it('retains backend failure and unavailable compiler coverage without erasing source candidates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'backend-closure-failure-'));
  directories.push(root);
  const path = join(root, 'Panel.tsx');
  writeFileSync(
    path,
    `function recurse() { return recurse(); } export function Panel(props: { mode: 'a' | 'b' }) { recurse(); return <div>{props.mode}</div>; }`,
  );
  const failed = (await extractReactComponents([path], undefined, { projectRoot: root, sourceClosureMaxIterations: 1 }))
    .components[0]!;
  expect(failed.componentFacts!.sourceClosure).toMatchObject({
    status: 'failed',
    reason: 'cycle-nonconvergence',
    summaries: [],
  });
  expect(readComponentFacts(failed.componentFacts).status).toBe('available');
  expect(failed.sourceCandidates?.find((item) => item.name === 'mode')).toBeDefined();
  const missing = (
    await extractReactComponents([path], undefined, { projectRoot: root, componentObservationLimits: { maxNodes: 0 } })
  ).components[0]!;
  expect(missing.componentFacts!.sourceClosure).toMatchObject({ status: 'unavailable', reason: 'root-unobserved' });
  expect(readComponentFacts(missing.componentFacts).status).toBe('available');
});
