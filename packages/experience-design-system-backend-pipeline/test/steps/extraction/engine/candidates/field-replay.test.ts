import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { extractReactComponents } from '../../../../../src/steps/extraction/index.js';
import { captureSourceEvidence } from '../../../../../src/steps/extraction/index.js';
import { bindSourceCandidatesToCapture } from '../../../../../src/steps/extraction/index.js';
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
import { collectFieldReplay } from '../../../../../src/steps/extraction/src/component-facts/collect-field-replay.js';
import ts from 'typescript';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

async function extract(body: string, key = 'alpha', maxNodes = 1000, includeGuard = false) {
  const root = mkdtempSync(join(tmpdir(), 'paired-field-'));
  directories.push(root);
  const path = join(root, 'Surface.tsx');
  writeFileSync(
    path,
    `export function Surface(props: { data: { ${JSON.stringify(key)}: string; beta: string }${includeGuard ? '; gate: boolean' : ''} }) { ${body} }`,
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
const branched = (body: string) => extract(body, 'alpha', 1000, true);

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
  'if (props.gate) { const next = { ...props.data, alpha: "first" }; return next.alpha; } const next = { ...props.data, alpha: "second" }; return next.alpha;',
  'const next = { ...props.data, alpha: "fixed" }; const alias = next; if (props.gate) { alias.alpha = "first"; } else { next.alpha = "second"; } return next.alpha;',
  'const next = { ...props.data, alpha: "fixed" }; if (props.gate) { next.alpha = "fixed"; } return next.alpha;',
  'return props.gate ? "first" : "second";',
])('compares every finite branch with private aliases intact: %s', async (body) => {
  const { replay, result, component } = await branched(body);
  expect(result.valueIndependence.status).toBe('conditional');
  expect(result.omissionSafety.status).toBe('conditional');
  expect(replay.operations.map((operation) => operation.operation)).toContain('branch');
  expect(readComponentFacts(component.componentFacts).status).toBe('available');
  const execute = new Function('props', body);
  for (const gate of [false, true]) {
    const baseline = execute({ data: { alpha: 'before', beta: 'other' }, gate });
    expect(execute({ data: { alpha: 'varied', beta: 'other' }, gate })).toBe(baseline);
    expect(execute({ data: { beta: 'other' }, gate })).toBe(baseline);
  }
});

it.each(['if (props.gate) return "fixed"; return "fixed";', 'return props.gate ? "fixed" : "fixed";'])(
  'collapses equal branch outcomes for a varying or omitted guard: %s',
  async (body) => {
    const { replay } = await branched(body);
    const guard = replay.results.find((result) => result.inputName === 'gate')!;
    expect(guard.valueIndependence.status).toBe('conditional');
    expect(guard.omissionSafety.status).toBe('conditional');
  },
);

it.each([
  'const next = { ...props.data }; if (props.gate) { next.alpha = "fixed"; } return next.alpha;',
  'const next = { ...props.data, alpha: "fixed" }; const alias = next; if (props.gate) { alias.alpha = props.data.alpha; } return next.alpha;',
  'if (props.gate) return props.data.alpha; return "fixed";',
  'return props.gate ? props.data.alpha : "fixed";',
])('retains dependence from any supported branch: %s', async (body) => {
  const { result } = await branched(body);
  expect(result.valueIndependence.status).toBe('unknown');
  expect(result.omissionSafety.status).toBe('unknown');
});

it('keeps unequal guard-controlled outcomes dependent', async () => {
  const { replay } = await branched('if (props.gate) return "first"; return "second";');
  const guard = replay.results.find((result) => result.inputName === 'gate')!;
  expect(guard.valueIndependence.status).toBe('unknown');
  expect(guard.omissionSafety.status).toBe('unknown');
});

it('replays branch conditions from full captured source after a live edit', async () => {
  const { root, path, component } = await branched('if (props.gate) return "first"; return "second";');
  const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
  const bound = bindSourceCandidatesToCapture([component], capture.files)[0]!;
  writeFileSync(path, 'changed');
  const checked = validateSavedFieldReplay(bound.componentFacts!.sourceObservations!.fieldSemantics!, capture.files);
  expect(checked.relationalReplay!.status).toBe('matched');
  expect(checked.relationalReplay!.operations.map((operation) => operation.operation)).toContain('branch');
});

it('does not reinterpret an earlier replay semantics version', async () => {
  const { component, replay } = await extract('return "fixed";');
  Object.assign(replay, { schemaVersion: 1 });
  replay.identity = fieldReplayIdentity(replay);
  expect(readComponentFacts(component.componentFacts).status).toBe('unsupported');
});

it.each(['if (true) return "fixed"; return props.data.alpha;', 'if (false) return props.data.alpha; return "fixed";'])(
  'uses exact inert literal guards to select feasible alternatives: %s',
  async (body) => {
    const { result } = await branched(body);
    expect(result.valueIndependence.status).toBe('conditional');
    expect(result.omissionSafety.status).toBe('conditional');
  },
);

it.each([
  'const next = { ...props.data }; const saved = next.alpha; if (props.gate) { next.alpha = "fixed"; } else { next.alpha = "fixed"; } return saved;',
  'const next = { ...props.data, alpha: "fixed" }; if (props.gate) { props.data.alpha = "other"; } return next.alpha;',
  'const next = { ...props.data, alpha: "fixed" }; if (props.gate) { unknown(next); } return next.alpha;',
  'const next = { ...props.data, alpha: "fixed" }; if (props.gate) { const next = { alpha: props.data.alpha }; } return next.alpha;',
  'const next = { ...props.data, alpha: "fixed" }; return props.gate ? (next.alpha = "first") : next.alpha;',
  'return props.gate ? { alpha: "first" } : { alpha: "second" };',
])('retains snapshots, effects and unsupported branch states: %s', async (body) => {
  const { result } = await branched(body);
  expect(result.valueIndependence.status).toBe('unknown');
  expect(result.omissionSafety.status).toBe('unknown');
});

it('binds guard occurrences and alternatives rather than trusting a rehashed fabricated trace', async () => {
  const { root, path, component, replay } = await branched('if (props.gate) return "first"; return "second";');
  const operation = replay.operations.find((operation) => operation.conditions.length)!;
  expect(operation).toBeDefined();
  operation.conditions[0]!.branch = operation.conditions[0]!.branch === 'truthy' ? 'falsy' : 'truthy';
  replay.identity = fieldReplayIdentity(replay);
  expect(readComponentFacts(component.componentFacts).status).toBe('available');
  const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
  const bound = bindSourceCandidatesToCapture([component], capture.files)[0]!;
  const checked = validateSavedFieldReplay(
    bound.componentFacts!.sourceObservations!.fieldSemantics!,
    capture.files,
  ).relationalReplay!;
  expect(checked.status).toBe('mismatch');
  expect(
    checked.results.every(
      (result) => result.valueIndependence.status === 'unknown' && result.omissionSafety.status === 'unknown',
    ),
  ).toBe(true);
});

it('bounds branch expansion and records exhausted paths as unknown', async () => {
  const { path, semantics, replay } = await branched(
    'const next = { ...props.data, alpha: "fixed" }; if (props.gate) { next.alpha = "first"; } else { next.alpha = "second"; } if (props.gate) { next.alpha = "third"; } return next.alpha;',
  );
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = source.statements.find(ts.isFunctionDeclaration)!;
  const bounded = collectFieldReplay(node, semantics, { ...replay.limits, maxNodes: 100 });
  expect(bounded.used.nodes).toBeLessThanOrEqual(100);
  expect(bounded.used.maxDepth).toBeLessThanOrEqual(bounded.limits.maxDepth);
  expect(bounded.results.some((result) => result.reasons.includes('paired-flow-bound'))).toBe(true);
  expect(
    bounded.results
      .filter((result) => result.reasons.includes('paired-flow-bound'))
      .every((result) => result.valueIndependence.status === 'unknown' && result.omissionSafety.status === 'unknown'),
  ).toBe(true);
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
