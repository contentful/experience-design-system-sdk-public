import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import * as api from '../../src/index.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
it('attaches nonempty source-bound closure evidence in the default public producer, including parameterless roots', async () => {
  const root = mkdtempSync(join(tmpdir(), 'source-closure-'));
  directories.push(root);
  const path = join(root, 'Panel.tsx');
  writeFileSync(
    path,
    `function leaf(value: string) { return value; }
export function Panel(props: { mode: 'short' | 'long'; read: (value: string) => string }) {
  const result = leaf(props.mode); props.read(result); return <div>{result}</div>;
}
export function Empty() { return <span />; }`,
  );
  const result = await api.extractReactComponents([path], undefined, { projectRoot: root });
  for (const component of result.components) {
    expect(component.componentFacts).toHaveProperty('sourceClosure');
    const evidence = component.componentFacts!.sourceClosure!;
    expect(evidence.schemaVersion).toBe(1);
    expect(evidence.rootId).toBe(component.componentFacts!.sourceObservations!.componentDeclarationId);
    expect(evidence.nodes.length).toBeGreaterThan(0);
    expect(evidence.summaries.find((summary) => summary.nodeId === evidence.rootId)?.facts.length).toBeGreaterThan(0);
  }
  const panel = result.components.find((component) => component.name === 'Panel')!;
  expect(panel.sourceCandidates?.find((candidate) => candidate.name === 'mode')?.facts?.domain.openness).toBe('closed');
  expect(
    panel
      .componentFacts!.sourceClosure!.nodes.flatMap((node) => node.ends)
      .some((end) => end.reason === 'input-supplied'),
  ).toBe(true);
});

it('preserves known alternatives, JSX dependency bodies and distinct reference destinations', async () => {
  const root = mkdtempSync(join(tmpdir(), 'source-alternatives-'));
  directories.push(root);
  const path = join(root, 'Panel.tsx');
  writeFileSync(
    path,
    `function Known(props: { ref?: unknown }) { return <i ref={props.ref} />; }
export function Panel(props: { flag: boolean; invoke: () => string; ref: unknown }) {
  const reader = props.flag ? Known : props.invoke;
  (props.flag ? Known : props.invoke)();
  return <Known ref={props.ref} title='example' />;
}`,
  );
  const component = (await api.extractReactComponents([path], undefined, { projectRoot: root })).components.find(
    (item) => item.name === 'Panel',
  )!;
  expect(component.componentFacts).toHaveProperty('sourceClosure');
  const closure = component.componentFacts!.sourceClosure!;
  expect(closure.nodes.length).toBeGreaterThan(1);
  expect(closure.nodes.flatMap((node) => node.ends).some((end) => end.reason === 'input-supplied')).toBe(true);
  const observations = component.componentFacts!.sourceObservations!.observations;
  expect(observations.find((item) => item.expression.startsWith('ref='))?.destination?.kind).toBe('reference');
  expect(observations.find((item) => item.expression.startsWith('title='))?.destination?.kind).toBe('markup-attribute');
  expect(observations.filter((item) => item.destination?.kind === 'reference')).toHaveLength(2);
});
it('exports a strict plain evidence reader that discloses unsupported versions and compiler objects', () => {
  expect(api).toHaveProperty('readSourceClosure', expect.any(Function));
  expect(api.readSourceClosure({ schemaVersion: 99 }).status).toBe('unsupported');
  expect(api.readSourceClosure({ schemaVersion: 1, compilerNode: new Date() }).status).toBe('corrupt');
});

it('exposes failed finite-budget cycles through the default producer while retaining declared fields', async () => {
  const root = mkdtempSync(join(tmpdir(), 'source-cycle-'));
  directories.push(root);
  const path = join(root, 'Panel.tsx');
  writeFileSync(
    path,
    `function recurse() { return recurse(); } export function Panel(props: { mode: 'a' | 'b' }) { recurse(); return <div>{props.mode}</div>; }`,
  );
  const component = (
    await api.extractReactComponents([path], undefined, { projectRoot: root, sourceClosureMaxIterations: 1 })
  ).components[0]!;
  expect(component.componentFacts!.sourceClosure).toMatchObject({
    status: 'failed',
    reason: 'cycle-nonconvergence',
    summaries: [],
  });
  expect(component.sourceCandidates?.find((item) => item.name === 'mode')?.facts?.domain.openness).toBe('closed');
});

it('rejects incomplete identities, fabricated observation membership, sparse values and unsafe evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'source-closure-guard-'));
  directories.push(root);
  const path = join(root, 'Panel.tsx');
  writeFileSync(path, `export function Panel() { return <div />; }`);
  const evidence = (await api.extractReactComponents([path], undefined, { projectRoot: root })).components[0]!
    .componentFacts!.sourceClosure!;
  expect(api.readSourceClosure(evidence).status).toBe('available');
  for (const mutate of [
    (value: api.SourceClosureEvidence) => {
      value.rootId = '';
    },
    (value: api.SourceClosureEvidence) => {
      value.reads = [];
    },
    (value: api.SourceClosureEvidence) => {
      value.nodes[0]!.location.textHash = null;
    },
    (value: api.SourceClosureEvidence) => {
      value.nodes[0]!.observationIds = ['fabricated'];
    },
    (value: api.SourceClosureEvidence) => {
      value.nodes = new Array(1);
    },
    (value: api.SourceClosureEvidence) => {
      value.summaries[0]!.facts = [];
    },
  ]) {
    const invalid = structuredClone(evidence);
    mutate(invalid);
    expect(api.readSourceClosure(invalid).status).toBe('corrupt');
  }
});
it('conserves missing roots, budget omissions, cancellation and changed or uncaptured source binding', async () => {
  const root = mkdtempSync(join(tmpdir(), 'source-closure-bound-'));
  directories.push(root);
  const path = join(root, 'Panel.tsx');
  writeFileSync(path, `export function Panel(props: { mode: 'a' | 'b' }) { return <div>{props.mode}</div>; }`);
  const component = (await api.extractReactComponents([path], undefined, { projectRoot: root })).components[0]!;
  const evidence = component.componentFacts!.sourceClosure!;
  const hash = evidence.nodes[0]!.location.textHash!;
  for (const [files, binding] of [
    [[], 'unavailable'],
    [[{ canonicalPath: path, textHash: null }], 'unverified'],
    [[{ canonicalPath: path, textHash: 'different' }], 'changed'],
    [[{ canonicalPath: path, textHash: hash }], 'verified'],
  ] as const) {
    expect(api.bindSourceClosureToCapture(evidence, files).binding).toBe(binding);
  }
  const limited = (
    await api.extractReactComponents([path], undefined, {
      projectRoot: root,
      componentObservationLimits: { maxNodes: 0 },
    })
  ).components[0]!;
  expect(limited.componentFacts!.sourceClosure).toMatchObject({ status: 'unavailable', reason: 'root-unobserved' });
  expect(limited.componentFacts!.sourceClosure!.omissions.some((item) => item.reason === 'maxNodes-limit')).toBe(true);
  expect(limited.sourceCandidates?.find((item) => item.name === 'mode')).toBeDefined();
  const cancelled = new AbortController();
  cancelled.abort(new Error('cancelled-source'));
  expect(() =>
    api.collectSourceClosure(component.componentFacts!.sourceObservations!, { signal: cancelled.signal }),
  ).toThrow('cancelled-source');
});

it('keeps generic proof and openness invariant when equivalent declarations and inputs are renamed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'closure-renaming-'));
  directories.push(root);
  const path = join(root, 'Panel.tsx');
  const source = `function leaf(value: string) { return value; } export function Panel(props: { mode: string }) { return <div>{leaf(props.mode)}</div>; }`;
  const shapes: unknown[] = [];
  for (const text of [
    source,
    source.replaceAll('leaf', 'read').replaceAll('Panel', 'Thing').replaceAll('mode', 'kind'),
  ]) {
    writeFileSync(path, text);
    const evidence = (await api.extractReactComponents([path], undefined, { projectRoot: root })).components[0]!
      .componentFacts!.sourceClosure!;
    shapes.push(
      evidence.summaries.map((summary) =>
        summary.facts.map((fact) => ({ kind: fact.kind, strength: fact.strength, open: fact.dependsOnOpenEnd })),
      ),
    );
  }
  expect(shapes[0]).toEqual(shapes[1]);
});

it('retains known branches beside external, input-supplied, dynamic and unresolved invocation evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'closure-open-alternatives-'));
  directories.push(root);
  const path = join(root, 'Panel.tsx');
  writeFileSync(
    path,
    `declare function external(value: string): string;
function known() { return <i />; }
export function Panel(props: { flag: boolean; injected: () => unknown; tools: Record<string, () => unknown>; key: string }) {
  (props.flag ? known : external)('value'); props.injected(); props.tools[props.key](); missingReader();
  const unused = props.injected; return <div>{known()}</div>;
}`,
  );
  const component = (await api.extractReactComponents([path], undefined, { projectRoot: root })).components[0]!;
  const evidence = component.componentFacts!.sourceClosure!;
  expect(evidence.nodes.length).toBeGreaterThan(1);
  expect(evidence.nodes.flatMap((node) => node.ends).map((end) => end.reason)).toEqual(
    expect.arrayContaining(['input-supplied', 'unresolved-target', 'declaration-body-unobserved']),
  );
  expect(
    component.componentFacts!.sourceObservations!.omissions.some((item) => item.reason === 'computed-key-unresolved'),
  ).toBe(true);
  const rootFacts = evidence.summaries.find((summary) => summary.nodeId === evidence.rootId)!.facts;
  expect(rootFacts.some((fact) => fact.ownerId !== evidence.rootId && fact.dependsOnOpenEnd)).toBe(true);
  expect(rootFacts.find((fact) => fact.ownerId === evidence.rootId && fact.kind === 'declaration')).toMatchObject({
    strength: 'exact',
    dependsOnOpenEnd: false,
  });
});
