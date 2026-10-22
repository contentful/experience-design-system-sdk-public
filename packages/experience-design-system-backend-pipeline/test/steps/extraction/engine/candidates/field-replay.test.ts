import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
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

it.each([
  'const values = [props.data.alpha, "fixed"]; return values[1];',
  'const values = [{ ...props.data, alpha: "fixed" }]; return values[0].alpha;',
  'const original = [props.data]; const values = [...original]; const next = { ...values[0], alpha: "fixed" }; return next.alpha;',
  'const original = [props.data.alpha]; const values = [...original, "fixed"]; return values[1];',
  'const values = [props.data.alpha]; const next = { ...values, 0: "fixed" }; return next[0];',
  'const values = [props.data.alpha, "fixed"]; return values.length;',
  'const values = []; return values.length;',
  'const index = 1; const values = [props.data.alpha, "fixed"]; return values[index];',
  'function read(values: { alpha: string; beta: string }[]) { return values[0].alpha; } const values = [{ ...props.data, alpha: "fixed" }]; return read(values);',
])('compares exact local collection construction and reads: %s', async (body) => {
  const { result, root, path, component, replay } = await extract(body);
  expect(result.valueIndependence.status).toBe('conditional');
  expect(result.omissionSafety.status).toBe('conditional');
  expect(result.valueIndependence.premises).toContain('standard-local-array-iteration');
  expect(replay.used.nodes).toBeLessThanOrEqual(replay.limits.maxNodes);
  const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
  const bound = bindSourceCandidatesToCapture([component], capture.files)[0]!;
  expect(
    validateSavedFieldReplay(bound.componentFacts!.sourceObservations!.fieldSemantics!, capture.files).relationalReplay!
      .status,
  ).toBe('matched');
});

it('preserves collection-to-record aliases when branching', async () => {
  const { result } = await branched(
    'const next = { ...props.data, alpha: "fixed" }; const values = [next]; if (props.gate) { values[0].alpha = "after"; } else { next.alpha = "after"; } return next.alpha;',
  );
  expect(result.valueIndependence.status).toBe('conditional');
  expect(result.omissionSafety.status).toBe('conditional');
  expect(result.valueComparison.left).toBe(result.valueComparison.right);
});

it('keeps an aliased branch overwrite independent without admitting absent-property creation', async () => {
  const { result } = await branched(
    'const next = { ...props.data }; const values = [next]; if (props.gate) { values[0].alpha = "fixed"; } else { next.alpha = "fixed"; } return next.alpha;',
  );
  expect(result.valueIndependence.status).toBe('conditional');
  expect(result.omissionSafety.status).toBe('unknown');
  expect(result.omissionSafety.reasons).toContain('paired-property-creation-open');
});

it.each([
  'const values = [props.data.alpha, "fixed"]; return values[1];',
  'const original = [props.data]; const values = [...original]; const next = { ...values[0], alpha: "fixed" }; return next.alpha;',
  'const values = [props.data.alpha]; const next = { 0: "fixed", ...values }; return next[0];',
])('checks collection comparisons against ordinary JavaScript execution: %s', async (body) => {
  const { result } = await extract(body);
  const execute = new Function('props', body) as (props: { data: { alpha?: string; beta: string } }) => unknown;
  const baseline = execute({ data: { alpha: 'first', beta: 'second' } });
  const variation = execute({ data: { alpha: 'changed', beta: 'second' } });
  const omission = execute({ data: { beta: 'second' } });
  const equal = baseline === variation;
  expect(result.valueIndependence.status).toBe(equal ? 'conditional' : 'unknown');
  expect(result.omissionSafety.status).toBe(baseline === omission ? 'conditional' : 'unknown');
});

it.each([
  'const values = [props.data.alpha]; return values[0];',
  'const values = [props.data]; return values[0].alpha;',
  'const values = [props.data.alpha]; const next = { 0: "fixed", ...values }; return next[0];',
])('preserves actual collection dependence: %s', async (body) => {
  const { result } = await extract(body);
  expect(result.valueIndependence.status).toBe('unknown');
  expect(result.omissionSafety.status).toBe('unknown');
  expect(result.valueIndependence.reasons).toContain('paired-results-differ');
});

it.each([
  'const values = [, "fixed"]; return values[1];',
  'const values = [props.data.alpha]; return values[2];',
  'const values = [props.data.alpha]; return values["01"];',
  'const values = [props.data.alpha]; return values[-1];',
  'const values = [props.data.alpha]; return values["__proto__"];',
  'const values = [...props.data]; return "fixed";',
  'const values = [unknown(), "fixed"]; return values[1];',
  'const values = [props.data.alpha]; values[0] = "fixed"; return values[0];',
  'const values = [props.data.alpha]; values.length = 0; return "fixed";',
  'const values = [props.data.alpha]; return values.map(() => "fixed");',
  'const values = [props.data.alpha]; return values;',
])('retains unestablished collection behavior: %s', async (body) => {
  const { result } = await extract(body);
  expect(result.valueIndependence.status).toBe('unknown');
  expect(result.omissionSafety.status).toBe('unknown');
  expect(result.reasons.length).toBeGreaterThan(0);
});

it('rejects collection replay that omits its iterator premise', async () => {
  const { component, result, replay } = await extract('const values = [props.data.alpha, "fixed"]; return values[1];');
  result.valueIndependence.premises = result.valueIndependence.premises.filter(
    (premise) => premise !== 'standard-local-array-iteration',
  );
  replay.identity = fieldReplayIdentity(replay);
  expect(readComponentFacts(component.componentFacts).status).toBe('corrupt');
});

it('requires local iteration applicability in the source derivation as well as paired replay', async () => {
  const { component, semantics } = await extract('const values = [props.data.alpha, "fixed"]; return values[1];');
  const proof = semantics.proofs.find((item) => item.inputName === 'data' && item.path[0]?.key === 'alpha')!;
  expect(proof.valueIndependence.status).toBe('conditional');
  expect(proof.valueIndependence.premises).toContain('standard-local-array-iteration');
  proof.valueIndependence.premises = proof.valueIndependence.premises.filter(
    (premise) => premise !== 'standard-local-array-iteration',
  );
  expect(readComponentFacts(component.componentFacts).status).toBe('corrupt');
});

it('rejects old interpreter versions without repairing historical evidence', async () => {
  const { component, replay } = await extract('return "fixed";');
  Object.assign(replay, { schemaVersion: 3 });
  replay.identity = fieldReplayIdentity(replay);
  expect(readComponentFacts(component.componentFacts).status).toBe('unsupported');
});

it('exposes a component-specific retention preview with separate unestablished applicability', async () => {
  const { component, semantics, replay } = await extract(
    'const next = { ...props.data, alpha: "fixed" }; return next.alpha;',
  );
  const before = JSON.stringify(component);
  const channel = JSON.parse(buildCompilerEvidenceInline([component], { readiness: 'caller-provided' }));
  const preview = channel.componentFacts[0].fieldProjectionPreview;
  expect(preview).toMatchObject({
    componentDeclarationId: semantics.componentDeclarationId,
    replayIdentity: replay.identity,
    replayStatus: 'unverified',
    mode: 'retention-only',
    uncoveredFields: 'retain',
  });
  const field = preview.fields.find(
    (field: { inputName: string; path: { key: string }[] }) =>
      field.inputName === 'data' && field.path[0]?.key === 'alpha',
  );
  expect(field).toMatchObject({
    valueIndependence: { status: 'conditional', applicability: 'unestablished' },
    omissionSafety: { status: 'conditional', applicability: 'unestablished' },
    disposition: 'retained-uncertainty',
  });
  expect(field.valueIndependence.unestablishedPremises).toContain('declared-own-input-tree');
  expect(field.omissionSafety.unestablishedPremises).toContain('entry-delivery-admits-omission');
  expect(field.valueIndependence.unestablishedPremises).not.toContain('entry-delivery-admits-omission');
  expect(JSON.stringify(component)).toBe(before);
});

it('retains matched conditional fields in the actual saved-source reasoning preview', async () => {
  const { root, path, component } = await extract('const next = { ...props.data, alpha: "fixed" }; return next.alpha;');
  const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
  const bound = bindSourceCandidatesToCapture([component], capture.files)[0]!;
  const facts = bound.componentFacts!;
  facts.sourceObservations!.fieldSemantics = validateSavedFieldReplay(
    facts.sourceObservations!.fieldSemantics!,
    capture.files,
  );
  const originalCandidates = JSON.stringify(bound.sourceCandidates);
  const channel = JSON.parse(buildCompilerEvidenceInline([bound], { readiness: 'caller-provided' }));
  const preview = channel.componentFacts[0].fieldProjectionPreview;
  expect(preview.replayStatus).toBe('matched');
  const field = preview.fields.find(
    (field: { inputName: string; path: { key: string }[] }) =>
      field.inputName === 'data' && field.path[0]?.key === 'alpha',
  );
  expect(field.disposition).toBe('conditional-retention');
  expect(field.omissionSafety.applicability).toBe('unestablished');
  expect(field.reasons).toContain('runtime-and-delivery-premises-unestablished');
  expect(JSON.stringify(bound.sourceCandidates)).toBe(originalCandidates);
});

it('does not turn value independence into omission admission in a projection preview', async () => {
  const { root, path, component } = await extract(
    'const next = { ...props.data }; next.alpha = "fixed"; return next.alpha;',
  );
  const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
  const bound = bindSourceCandidatesToCapture([component], capture.files)[0]!;
  bound.componentFacts!.sourceObservations!.fieldSemantics = validateSavedFieldReplay(
    bound.componentFacts!.sourceObservations!.fieldSemantics!,
    capture.files,
  );
  const channel = JSON.parse(buildCompilerEvidenceInline([bound], { readiness: 'caller-provided' }));
  const preview = channel.componentFacts[0].fieldProjectionPreview;
  const field = preview.fields.find(
    (field: { inputName: string; path: { key: string }[] }) =>
      field.inputName === 'data' && field.path[0]?.key === 'alpha',
  );
  expect(field).toMatchObject({
    valueIndependence: { status: 'conditional' },
    omissionSafety: { status: 'unknown', reasons: expect.arrayContaining(['paired-property-creation-open']) },
    disposition: 'retained-uncertainty',
  });
});

it.each(['corrupt', 'unsupported', 'unknown-legacy'] as const)(
  'withholds the projection preview when component evidence is %s',
  async (status) => {
    const { component } = await extract('return "fixed";');
    const channel = JSON.parse(
      buildCompilerEvidenceInline([{ ...component, componentEvidenceReadStatus: status }], { readiness: 'ready' }),
    );
    expect(channel.componentFacts[0].fieldProjectionPreview).toBeUndefined();
  },
);

it.each(['ready', 'unavailable'] as const)(
  'withholds caller-provided projection hints when readiness is %s',
  async (readiness) => {
    const { component } = await extract('return "fixed";');
    Object.assign(component, { fieldProjectionPreview: { mode: 'remove', fields: [] } });
    const before = JSON.stringify(component);
    const channel = JSON.parse(buildCompilerEvidenceInline([component], { readiness }));
    expect(channel.componentFacts[0].fieldProjectionPreview).toBeUndefined();
    expect(JSON.stringify(component)).toBe(before);
  },
);

it('does not promote serialized matched replay into established applicability', async () => {
  const { component, replay } = await extract('return "fixed";');
  replay.status = 'matched';
  Object.assign(component, { fieldProjectionPreview: { mode: 'remove', fields: [] } });
  const channel = JSON.parse(buildCompilerEvidenceInline([component], { readiness: 'caller-provided' }));
  const preview = channel.componentFacts[0].fieldProjectionPreview;
  expect(preview.mode).toBe('retention-only');
  expect(preview.uncoveredFields).toBe('retain');
  expect(preview.fields.length).toBeGreaterThan(0);
  expect(
    preview.fields.every(
      (field: { valueIndependence: { applicability: string }; omissionSafety: { applicability: string } }) =>
        field.valueIndependence.applicability === 'unestablished' &&
        field.omissionSafety.applicability === 'unestablished',
    ),
  ).toBe(true);
});

it('withholds the projection preview when paired replay is absent', async () => {
  const { component, semantics } = await extract('return "fixed";');
  delete semantics.relationalReplay;
  const channel = JSON.parse(buildCompilerEvidenceInline([component], { readiness: 'caller-provided' }));
  expect(channel.componentFacts[0].status).toBe('available');
  expect(channel.componentFacts[0].fieldProjectionPreview).toBeUndefined();
});

it.each(['__proto__', 'constructor', 'a.b', 'a/b', ''])(
  'keeps exact field identity and source shapes in the projection preview for %s',
  async (key) => {
    const { component, replay } = await extract('return "fixed";', key);
    const before = JSON.stringify(component);
    const channel = JSON.parse(buildCompilerEvidenceInline([component], { readiness: 'caller-provided' }));
    const preview = channel.componentFacts[0].fieldProjectionPreview;
    const field = preview.fields.find((field: { path: { key: string }[] }) => field.path[0]?.key === key);
    expect(field.path).toEqual([{ kind: 'field', key }]);
    expect(
      preview.fields.map((field: { inputName: string; path: unknown }) => ({
        inputName: field.inputName,
        path: field.path,
      })),
    ).toEqual(replay.domain);
    expect(JSON.stringify(component)).toBe(before);
  },
);

it('keeps a shared source shape and sibling components independent of projection previews', async () => {
  const root = mkdtempSync(join(tmpdir(), 'shared-projection-'));
  directories.push(root);
  const path = join(root, 'Surfaces.tsx');
  writeFileSync(
    path,
    `
    type Shared = { alpha: string; beta: string };
    export function First(props: { data: Shared }) { return "fixed"; }
    export function Second(props: { data: Shared }) { return props.data.alpha; }
  `,
  );
  const { components } = await extractReactComponents([path], undefined, { projectRoot: root });
  expect(components).toHaveLength(2);
  const before = JSON.stringify(components);
  const channel = JSON.parse(buildCompilerEvidenceInline(components, { readiness: 'caller-provided' }));
  const first = channel.componentFacts.find(
    (entry: { componentName: string }) => entry.componentName === 'First',
  ).fieldProjectionPreview;
  const second = channel.componentFacts.find(
    (entry: { componentName: string }) => entry.componentName === 'Second',
  ).fieldProjectionPreview;
  expect(first.componentDeclarationId).not.toBe(second.componentDeclarationId);
  expect(
    first.fields.find((field: { path: { key: string }[] }) => field.path[0]?.key === 'alpha').valueIndependence.status,
  ).toBe('conditional');
  expect(
    second.fields.find((field: { path: { key: string }[] }) => field.path[0]?.key === 'alpha').valueIndependence.status,
  ).toBe('unknown');
  expect(JSON.stringify(components)).toBe(before);
});

it('retains uncertainty in the projection preview after a captured-source mismatch', async () => {
  const { component, replay, root, path } = await extract('return "fixed";');
  replay.results[0]!.valueComparison = { left: 'f'.repeat(64), right: 'f'.repeat(64) };
  replay.identity = fieldReplayIdentity(replay);
  const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
  const bound = bindSourceCandidatesToCapture([component], capture.files)[0]!;
  const semantics = bound.componentFacts!.sourceObservations!.fieldSemantics!;
  bound.componentFacts!.sourceObservations!.fieldSemantics = validateSavedFieldReplay(semantics, capture.files);
  const channel = JSON.parse(buildCompilerEvidenceInline([bound], { readiness: 'caller-provided' }));
  const preview = channel.componentFacts[0].fieldProjectionPreview;
  expect(preview.replayStatus).toBe('mismatch');
  expect(preview.fields.every((field: { disposition: string }) => field.disposition === 'retained-uncertainty')).toBe(
    true,
  );
  expect(preview.fields[0].reasons).toContain('source-replay-mismatch');
});

it('retains uncertainty in the projection preview when captured bytes are unavailable', async () => {
  const { component, semantics } = await extract('return "fixed";');
  component.componentFacts!.sourceObservations!.fieldSemantics = validateSavedFieldReplay(semantics, []);
  const channel = JSON.parse(buildCompilerEvidenceInline([component], { readiness: 'caller-provided' }));
  const preview = channel.componentFacts[0].fieldProjectionPreview;
  expect(preview.replayStatus).toBe('unavailable');
  expect(preview.fields.every((field: { disposition: string }) => field.disposition === 'retained-uncertainty')).toBe(
    true,
  );
});

it.each([
  'function read(value: { alpha: string; beta: string }) { const next = { ...value, alpha: "fixed" }; return next.alpha; } return read(props.data);',
  'const read = (value: { alpha: string; beta: string }) => { const next = { ...value, alpha: "fixed" }; return next.alpha; }; return read(props.data);',
  'function read(value: { alpha: string; beta: string }) { return "fixed"; } const alias = read; return alias(props.data);',
  'function read(value: { alpha: string; beta: string }, gate: boolean) { if (gate) return "first"; return "second"; } return read(props.data, props.gate);',
])('replays compiler-resolved synchronous helper frames: %s', async (body) => {
  const { replay, result, component, root, path } = await branched(body);
  expect(result.valueIndependence.status).toBe('conditional');
  expect(result.omissionSafety.status).toBe('conditional');
  expect(replay.operations.some((operation) => operation.operation === 'call' && operation.frame > 0)).toBe(true);
  expect(readComponentFacts(component.componentFacts).status).toBe('available');
  const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
  const bound = bindSourceCandidatesToCapture([component], capture.files)[0]!;
  writeFileSync(path, 'changed');
  const checked = validateSavedFieldReplay(bound.componentFacts!.sourceObservations!.fieldSemantics!, capture.files);
  expect(checked.relationalReplay!.status).toBe('matched');
});

it.each([
  'function read(value: { alpha: string; beta: string }) { return value.alpha; } return read(props.data);',
  'function read(value: { alpha: string; beta: string }) { value.alpha = "fixed"; return "fixed"; } return read(props.data);',
  'function read(value: { alpha: string; beta: string }) { return read(value); } return read(props.data);',
  'function read(value: { alpha: string; beta: string }) { return { alpha: "fixed" }; } return read(props.data);',
  'function read(value: { alpha: string; beta: string }) { return "fixed"; } const readOther = (value: { alpha: string; beta: string }) => value.alpha; return readOther(props.data);',
  'function read(value: { alpha: string; beta: string }) { return "fixed"; } const owner = { read }; return owner.read(props.data);',
  'function read(value: { alpha: string; beta: string } = props.data) { return "fixed"; } return read();',
])('retains helper dependence and unsupported invocation/effect obligations: %s', async (body) => {
  const { result } = await branched(body);
  expect(result.valueIndependence.status).toBe('unknown');
  expect(result.omissionSafety.status).toBe('unknown');
});

it('binds repeated helper frames to their exact invocation and rejects a fabricated frame', async () => {
  const { component, replay } = await branched(
    'function read(value: { alpha: string; beta: string }) { return "fixed"; } read(props.data); return read(props.data);',
  );
  const calls = replay.operations.filter((operation) => operation.operation === 'call');
  expect(new Set(calls.map((operation) => operation.frame)).size).toBe(2);
  calls[0]!.frame += 100;
  replay.identity = fieldReplayIdentity(replay);
  expect(readComponentFacts(component.componentFacts).status).toBe('corrupt');
});

it.each([
  'function read(value: { alpha: string; beta: string }) { const next = { ...value, alpha: "fixed" }; next.alpha = "after"; return next.alpha; } return read(props.data);',
  'function read(props: { alpha: string; beta: string }) { return props.alpha; } const next = { ...props.data, alpha: "fixed" }; return read(next);',
  'function read(value: { alpha: string; beta: string }) { return "fixed"; } function invoke(fn: typeof read, value: { alpha: string; beta: string }) { return fn(value); } return invoke(read, props.data);',
])('preserves private allocations and declaration identity across helper frames: %s', async (body) => {
  const { result, root, path, component } = await branched(body);
  expect(result.valueIndependence.status).toBe('conditional');
  expect(result.omissionSafety.status).toBe('conditional');
  const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
  const bound = bindSourceCandidatesToCapture([component], capture.files)[0]!;
  const checked = validateSavedFieldReplay(bound.componentFacts!.sourceObservations!.fieldSemantics!, capture.files);
  expect(checked.relationalReplay!.status).toBe('matched');
});

it.each([
  'const saved = props.data.alpha; const read = () => saved; return read();',
  'const next = { ...props.data, alpha: "fixed" }; function read(value: typeof next) { value.alpha = "after"; return "fixed"; } return read(next);',
  'function read(value: { alpha: string; beta: string }) { return "fixed"; } read = (value) => value.alpha; return read(props.data);',
  'function read(value: { alpha: string; beta: string }) { return "fixed"; } return read(props.data, unknown());',
  'function read(value: { alpha: string; beta: string }) { const next = { ...value }; next.alpha = "fixed"; return next.alpha; } return read(props.data);',
])('keeps closures, caller writes, mutable targets, extra effects and omission creation open: %s', async (body) => {
  const { result } = await branched(body);
  expect(result.omissionSafety.status).toBe('unknown');
});

it('rejects rehashed helper target provenance during captured-source replay', async () => {
  const { root, path, component, replay } = await branched(
    'function read(value: { alpha: string; beta: string }) { return "fixed"; } return read(props.data);',
  );
  expect(replay.frames.length).toBeGreaterThan(0);
  replay.frames[0]!.targetStartOffset += 1;
  replay.identity = fieldReplayIdentity(replay);
  expect(readComponentFacts(component.componentFacts).status).toBe('available');
  const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
  const bound = bindSourceCandidatesToCapture([component], capture.files)[0]!;
  const checked = validateSavedFieldReplay(bound.componentFacts!.sourceObservations!.fieldSemantics!, capture.files);
  expect(checked.relationalReplay!.status).toBe('mismatch');
  expect(checked.relationalReplay!.results.every((result) => result.valueIndependence.status === 'unknown')).toBe(true);
});

it('does not confuse a computed identifier with its runtime property key', async () => {
  const { result } = await extract(
    'const alpha = "beta"; const next = { ...props.data, [alpha]: "fixed" }; return next.alpha;',
  );
  expect(result.valueIndependence.status).toBe('unknown');
  expect(result.omissionSafety.status).toBe('unknown');
});

it('uses declaration-bound computed keys in a helper instead of their binding names', async () => {
  const { result } = await extract(
    'function read(value: { alpha: string; beta: string }) { const key = "alpha"; const next = { ...value, [key]: "fixed" }; return next[key]; } return read(props.data);',
  );
  expect(result.reasons).toEqual([]);
  expect(result.valueIndependence.status).toBe('conditional');
  expect(result.omissionSafety.status).toBe('conditional');
});

it('makes helper-binding stability an explicit unestablished premise', async () => {
  const { result } = await extract(
    'function read(value: { alpha: string; beta: string }) { return "fixed"; } return read(props.data);',
  );
  expect(result.valueIndependence.premises).toContain('stable-resolved-callable-bindings');
});

it('resolves captured helper symbols without reading the host compiler filesystem', async () => {
  const { root, path, component } = await extract(
    'function read(value: { alpha: string; beta: string }) { return "fixed"; } return read(props.data);',
  );
  const capture = await captureSourceEvidence({ projectRoot: root, filePaths: [path] });
  const bound = bindSourceCandidatesToCapture([component], capture.files)[0]!;
  const read = vi.spyOn(ts.sys, 'readFile').mockImplementation(() => {
    throw new Error('host read forbidden');
  });
  const exists = vi.spyOn(ts.sys, 'fileExists').mockImplementation(() => {
    throw new Error('host lookup forbidden');
  });
  try {
    const checked = validateSavedFieldReplay(bound.componentFacts!.sourceObservations!.fieldSemantics!, capture.files);
    expect(checked.relationalReplay!.status).toBe('matched');
    expect(read).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
  } finally {
    read.mockRestore();
    exists.mockRestore();
  }
});

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
  'const next = { ...props.data, alpha: "fixed" }; if (props.gate) { const next = { alpha: props.data.alpha }; } return next.alpha;',
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

it.each([
  'const next = { ...props.data, alpha: "fixed" }; return next.alpha;',
  'function read(value: { alpha: string; beta: string }) { const next = { ...value, alpha: "fixed" }; return next.alpha; } return read(props.data);',
  'const original = [props.data]; const values = [...original]; const next = { ...values[0], alpha: "fixed" }; return next.alpha;',
])(
  'replays the exact saved source after the live file changes and carries it into the reasoning channel: %s',
  async (body) => {
    const { root, path, component } = await extract(body);
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
      const preview = channel.componentFacts[0].fieldProjectionPreview;
      expect(preview).toMatchObject({
        componentDeclarationId: replay.componentDeclarationId,
        replayIdentity: replay.identity,
        replayStatus: 'matched',
        mode: 'retention-only',
        uncoveredFields: 'retain',
      });
      const projected = preview.fields.find(
        (field: { inputName: string; path: { key: string }[] }) =>
          field.inputName === 'data' && field.path[0]?.key === 'alpha',
      );
      expect(projected.disposition).toBe('conditional-retention');
      expect(projected.omissionSafety.unestablishedPremises).toContain('entry-delivery-admits-omission');
      expect(projected.valueIndependence.unestablishedPremises).not.toContain('entry-delivery-admits-omission');
      const originalSaved = JSON.stringify(saved);
      projected.path[0].key = 'changed-preview-only';
      expect(JSON.stringify(saved)).toBe(originalSaved);
    } finally {
      reopened.close();
    }
  },
);

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
