import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { extractReactComponents } from '../../../../../src/steps/extraction/index.js';
import { captureSourceEvidence } from '../../../../../src/steps/extraction/index.js';
import {
  openPipelineDb,
  getOrCreateSession,
  createStep,
  completeExtractionWithSourceEvidence,
  loadRawComponents,
} from '../../../../../src/persistence/src/session/repositories/db.js';
import { fieldReplayIdentity } from '../../../../../src/steps/extraction/src/types/field-replay.js';
import { readComponentFacts } from '../../../../../src/persistence/src/session/repositories/component-facts-validation.js';
import { buildCompilerEvidenceInline } from '../../../../../src/agents/prompts/helpers/build-compiler-evidence-inline.js';
import { validateSavedFieldReplay } from '../../../../../src/persistence/src/session/repositories/field-replay-binding.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

async function extract(body: string, key = 'alpha', maxNodes = 1000) {
  const root = mkdtempSync(join(tmpdir(), 'paired-field-'));
  directories.push(root);
  const path = join(root, 'Surface.tsx');
  writeFileSync(
    path,
    `export function Surface(props: { data: { ${JSON.stringify(key)}: string; beta: string } }) { ${body} }`,
  );
  const component = (
    await extractReactComponents([path], undefined, { projectRoot: root, componentObservationLimits: { maxNodes } })
  ).components[0]!;
  const semantics = component.componentFacts!.sourceObservations!.fieldSemantics!;
  const replay = semantics.relationalReplay!;
  expect(replay).toBeDefined();
  const result = replay.results.find(
    (item) => item.inputName === 'data' && item.path.length === 1 && item.path[0]!.key === key,
  )!;
  expect(result).toBeDefined();
  return { root, path, component, semantics, replay, result };
}

it.each(['const next = { ...props.data, alpha: "fixed" }; return next.alpha;'])(
  'compares symbolic values and own-field omission separately: %s',
  async (body) => {
    const { replay, result, semantics, component } = await extract(body);
    expect(replay.status).toBe('unverified');
    expect(replay.componentDeclarationId).toBe(semantics.componentDeclarationId);
    expect(replay.identity).toMatch(/^[a-f0-9]{64}$/);
    expect(result.valueIndependence.status).toBe('conditional');
    expect(result.omissionSafety.status).toBe('conditional');
    expect(result.omissionSafety.premises).toContain('entry-delivery-admits-omission');
    expect(result.omissionSafety.premises).toContain('declared-own-input-tree');
    expect(
      replay.operations.every((operation) => operation.frame === 0 && operation.endOffset > operation.startOffset),
    ).toBe(true);
    expect(component.sourceCandidates!.find((candidate) => candidate.name === 'data')).toBeDefined();
  },
);

it('keeps value independence separate from unknown property creation after omission', async () => {
  const { result } = await extract(
    'const next = { ...props.data }; const alias = next; alias.alpha = "fixed"; return next.alpha;',
  );
  expect(result.valueIndependence.status).toBe('conditional');
  expect(result.omissionSafety.status).toBe('unknown');
  expect(result.reasons).toContain('paired-property-creation-open');
});

it.each([
  'return props.data.alpha;',
  'const saved = props.data.alpha; const next = { ...props.data, alpha: "fixed" }; return saved;',
  'const next = { alpha: "fixed", ...props.data }; return next.alpha;',
])('does not promote unequal paired results: %s', async (body) => {
  const { result } = await extract(body);
  expect(result.valueIndependence.status).toBe('unknown');
  expect(result.omissionSafety.status).toBe('unknown');
});

it.each([
  'const next = { ...props.data, alpha: "fixed" }; return next;',
  'while (true) {} return "fixed";',
  'const next = { ...props.data, alpha: "fixed" }; unknown(next); return next.alpha;',
  'const next = { ...props.data }; next["__proto__"] = "fixed"; return "fixed";',
  'props.data.alpha = "fixed"; return "fixed";',
])('retains unsupported observables or effects: %s', async (body) => {
  const { result } = await extract(body);
  expect(result.valueIndependence.status).toBe('unknown');
  expect(result.omissionSafety.status).toBe('unknown');
  expect(result.reasons.length).toBeGreaterThan(0);
});

it.each(['a.b', '', '__proto__'])('preserves exact own key %j', async (key) => {
  const { result } = await extract(
    `const next = { ...props.data, [${JSON.stringify(key)}]: "fixed" }; return next[${JSON.stringify(key)}];`,
    key,
  );
  expect(result.valueIndependence.status).toBe('conditional');
  expect(result.omissionSafety.status).toBe('conditional');
});

it.each(['1e2', '[1e2]'])('uses runtime numeric property keys for %s', async (numericKey) => {
  const { result } = await extract(
    `const next = { ...props.data, ${numericKey}: "fixed" }; return next["1e2"];`,
    '1e2',
  );
  expect(result.valueIndependence.status).toBe('unknown');
  expect(result.omissionSafety.status).toBe('unknown');
});

it('downgrades exhausted paired evaluation without exceeding its bound', async () => {
  const { replay } = await extract('const next = { ...props.data, alpha: "fixed" }; return next.alpha;', 'alpha', 35);
  expect(replay.used.nodes).toBeLessThanOrEqual(35);
  expect(replay.results.some((result) => result.reasons.includes('paired-flow-bound'))).toBe(true);
  expect(readComponentFacts((await extract('return "fixed";')).component.componentFacts).status).toBe('available');
});

it.each(['maxNodes', 'maxDepth', 'maxOperations'] as const)(
  'rejects widening the recorded %s replay limit',
  async (key) => {
    const { component, replay, semantics } = await extract(
      'const next = { ...props.data, alpha: "fixed" }; return next.alpha;',
    );
    replay.limits[key] += 1;
    replay.identity = fieldReplayIdentity(replay);
    expect(semantics.relationalReplay).toBe(replay);
    expect(readComponentFacts(component.componentFacts).status).toBe('corrupt');
  },
);

it('does not accept a conditional certificate with incomplete source coverage', async () => {
  const { component, semantics } = await extract('const next = { ...props.data, alpha: "fixed" }; return next.alpha;');
  semantics.coverage = 'partial';
  semantics.omissions.push({ reason: 'input-shape-open', location: semantics.source });
  for (const proof of semantics.proofs) {
    proof.valueIndependence = { status: 'unknown', premises: [], reasons: ['input-shape-open'] };
    proof.omissionSafety = { status: 'unknown', premises: [], reasons: ['input-shape-open'] };
  }
  expect(readComponentFacts(component.componentFacts).status).toBe('corrupt');
});

it('withholds paired claims when full captured bytes are unavailable', async () => {
  const { semantics } = await extract('const next = { ...props.data, alpha: "fixed" }; return next.alpha;');
  const checked = validateSavedFieldReplay(semantics, []);
  expect(checked.relationalReplay!.status).toBe('unavailable');
  expect(
    checked.relationalReplay!.results.every(
      (item) => item.valueIndependence.status === 'unknown' && item.omissionSafety.status === 'unknown',
    ),
  ).toBe(true);
});

it('replays an independent field certificate even without a closure sidecar', async () => {
  const { root, path, component } = await extract('const next = { ...props.data, alpha: "fixed" }; return next.alpha;');
  delete component.componentFacts!.sourceClosure;
  const db = openPipelineDb(join(root, 'pipeline.db'));
  try {
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
    completeExtractionWithSourceEvidence(db, {
      sessionId,
      stepId: createStep(db, sessionId, 'analyze extract', {}),
      components: [component],
      cycles: [],
      scannedFiles: ['Surface.tsx'],
      capture,
      observations: { accepted: [], rejected: [] },
    });
    expect(
      loadRawComponents(db, sessionId)[0]!.componentFacts!.sourceObservations!.fieldSemantics!.relationalReplay!.status,
    ).toBe('matched');
  } finally {
    db.close();
  }
});

it('replays the exact saved source after the live file changes and carries it into the reasoning channel', async () => {
  const { root, path, component } = await extract('const next = { ...props.data, alpha: "fixed" }; return next.alpha;');
  const dbPath = join(root, 'pipeline.db');
  const db = openPipelineDb(dbPath);
  const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
  const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
  completeExtractionWithSourceEvidence(db, {
    sessionId,
    stepId: createStep(db, sessionId, 'analyze extract', {}),
    components: [component],
    cycles: [],
    scannedFiles: ['Surface.tsx'],
    capture,
    observations: { accepted: [], rejected: [] },
  });
  db.close();
  writeFileSync(path, 'changed live source');
  const reopened = openPipelineDb(dbPath);
  try {
    const saved = loadRawComponents(reopened, sessionId)[0]!;
    const replay = saved.componentFacts!.sourceObservations!.fieldSemantics!.relationalReplay!;
    expect(replay.status).toBe('matched');
    const result = replay.results.find((item) => item.inputName === 'data' && item.path[0]?.key === 'alpha')!;
    expect(result.omissionSafety.status).toBe('conditional');
    expect(saved.sourceCandidates!.find((candidate) => candidate.name === 'data')).toBeDefined();
    const channel = JSON.parse(buildCompilerEvidenceInline([saved], { readiness: 'ready' }));
    expect(channel.componentFacts[0].facts.sourceObservations.fieldSemantics.relationalReplay).toEqual(replay);
    expect(channel.componentFacts[0].fieldSemanticsPolicy).toEqual({
      claims: 'conditional-advisory',
      replay: 'source-reproduction-only',
      runtimeAndDeliveryApplicability: 'unestablished',
      schemaChanges: 'not-authorized',
    });
  } finally {
    reopened.close();
  }
});

it('rejects a self-consistent but fabricated comparison when replayed against captured source', async () => {
  const { root, path, component, replay } = await extract(
    'const next = { ...props.data, alpha: "fixed" }; return next.alpha;',
  );
  const result = replay.results.find((item) => item.inputName === 'data' && item.path[0]?.key === 'alpha')!;
  result.valueComparison = { left: 'f'.repeat(64), right: 'f'.repeat(64) };
  replay.identity = fieldReplayIdentity(replay);
  expect(readComponentFacts(component.componentFacts).status).toBe('available');
  const db = openPipelineDb(join(root, 'pipeline.db'));
  try {
    const { sessionId } = getOrCreateSession(db, 'new', undefined, { command: 'analyze extract' });
    const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
    completeExtractionWithSourceEvidence(db, {
      sessionId,
      stepId: createStep(db, sessionId, 'analyze extract', {}),
      components: [component],
      cycles: [],
      scannedFiles: ['Surface.tsx'],
      capture,
      observations: { accepted: [], rejected: [] },
    });
    const saved = loadRawComponents(db, sessionId)[0]!;
    const checked = saved.componentFacts!.sourceObservations!.fieldSemantics!.relationalReplay!;
    expect(checked.status).toBe('mismatch');
    expect(
      checked.results.every(
        (item) => item.valueIndependence.status === 'unknown' && item.omissionSafety.status === 'unknown',
      ),
    ).toBe(true);
    expect(saved.sourceCandidates!.find((candidate) => candidate.name === 'data')).toBeDefined();
  } finally {
    db.close();
  }
});
