import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import * as api from '../../src/index.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
async function fixture(caller: string, files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'source-references-'));
  roots.push(root);
  const selected = join(root, 'Surface.tsx');
  const evidence = join(root, 'Context.test.tsx');
  writeFileSync(
    selected,
    `export function Surface(props: { label: string; mode: 'a' | 'b'; children?: unknown }) { return <section>{props.label}</section>; }`,
  );
  writeFileSync(evidence, caller);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text);
  writeFileSync(
    join(root, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { jsx: 'preserve', baseUrl: '.', paths: { '@surface': ['./Surface'] } } }),
  );
  const result = await api.extractReactComponents([selected], undefined, {
    projectRoot: root,
    evidenceFilePaths: [evidence],
  });
  return { root, selected, evidence, result, component: result.components.find((item) => item.name === 'Surface')! };
}
it('indexes incoming configured evidence without promoting its declarations to extraction roots', async () => {
  const { component, result, evidence } = await fixture(
    `import { Surface as Renamed } from '@surface'; export function Context(){ const unused = () => <Renamed label="sample" mode="outside" />; return null; } const top = <Renamed label="top" mode="a" />;`,
  );
  expect(result.components.map((item) => item.name)).toEqual(['Surface']);
  const index = component.componentFacts?.sourceObservations?.referenceIndex;
  expect(index).toBeDefined();
  expect(index!.references.filter((item) => item.kind === 'jsx')).toHaveLength(2);
  expect(index!.references.every((item) => item.location.canonicalPath !== null)).toBe(true);
  expect(index!.references.filter((item) => item.kind === 'jsx').some((item) => item.owner === null)).toBe(true);
  expect(index!.references.find((item) => item.kind === 'jsx' && item.owner)?.ancestors.length).toBeGreaterThan(1);
  expect(index!.files.some((item) => item.location.canonicalPath === realpathSync(evidence) && !item.selected)).toBe(
    true,
  );
  expect(index!.semantics).toBe('lexical-reference-observations');
  expect(component.sourceCandidates!.find((item) => item.name === 'label')?.facts?.domain.openness).toBe('open');
});
it('retains every guarded callable target while keeping same-name declarations distinct', async () => {
  const { component } = await fixture(
    `import {Surface} from '@surface';import {Surface as Other} from './Other';declare const gate:boolean;const Choice=gate?Surface:Other;const sighting=<Choice label="known" mode="a"/>;const unrelated=<Other label="separate" mode="a"/>;`,
    { 'Other.tsx': `export function Surface(props:{label:string;mode:string}){return <i/>}` },
  );
  const index = component.componentFacts!.sourceObservations!.referenceIndex!;
  const references = index.references.filter((item) => item.kind === 'jsx');
  expect(references).toHaveLength(1);
  expect(references[0]!.targets).toHaveLength(2);
  expect(new Set(references[0]!.targets.map((target) => target.declarationId)).size).toBe(2);
  expect(references[0]!.targets.every((target) => target.conditions.length > 0)).toBe(true);
});
it('aggregates direct object-call values, omitted inputs and unknown shifted arity', async () => {
  const { component } = await fixture(
    `import {Surface} from '@surface';const fixed={label:'direct',mode:'outside'};Surface(fixed);Surface();declare const args:unknown[];Surface(...args,{label:'shifted',mode:'a'});`,
  );
  const index = component.componentFacts!.sourceObservations!.referenceIndex!;
  const summary = index.summaries.find((item) => item.inputName === 'label')!;
  expect(summary.counts).toMatchObject({ provided: 1, omitted: 1, unknown: 1 });
  expect(summary.samples.map((item) => item.value)).toEqual(['direct']);
  expect(index.summaries.find((item) => item.inputName === 'mode')?.samples[0]?.violation).toBe(true);
});
it('invalidates property/base mutations and preserves unrelated shadowed immutable samples', async () => {
  const { component } = await fixture(
    `import {Surface} from '@surface';const source={value:'original'};source.value='changed';const first=<Surface label={source.value} mode="a"/>;const fixed='stable';function inner(){let fixed='local';fixed+='write';return fixed;}const second=<Surface label={fixed} mode="b"/>;`,
  );
  const calls = component.componentFacts!.sourceObservations!.referenceIndex!.references.filter(
    (item) => item.kind === 'jsx',
  );
  expect(calls[0]!.inputs.find((item) => item.name === 'label')?.state).toBe('unknown');
  expect(calls[1]!.inputs.find((item) => item.name === 'label')?.value).toBe('stable');
});
it('keeps unsafe numeric samples uncertain and preserves ordered children and explicit children values', async () => {
  const { component } = await fixture(
    `import {Surface} from '@surface';const a=<Surface label={1e999} mode="a" children="explicit"/>;const b=<Surface label="safe" mode="b" children="overridden">text<b/></Surface>;`,
  );
  const index = component.componentFacts!.sourceObservations!.referenceIndex!;
  const calls = index.references.filter((item) => item.kind === 'jsx');
  expect(calls[0]!.inputs.find((item) => item.name === 'label')?.reasons).toContain('unsafe-literal-number');
  expect(calls[0]!.inputs.find((item) => item.name === 'children')?.value).toBe('explicit');
  expect(calls[1]!.inputs.find((item) => item.name === 'children')?.parts).toHaveLength(2);
  expect(api.readSourceReferences(index).status).toBe('available');
});
it('preserves effective order, partial coverage and caller summaries without granting output authority', async () => {
  const { component } = await fixture(
    `import { Surface } from '@surface'; declare const unknown: Record<string, unknown>; const key = 'label'; const fixed = 'same'; const one = <Surface label="before" {...unknown} mode="a"/>; const two = <Surface {...unknown} label={fixed} mode="b">text<b /></Surface>;`,
  );
  const index = component.componentFacts?.sourceObservations?.referenceIndex;
  expect(index).toBeDefined();
  const calls = index!.references.filter((item) => item.kind === 'jsx');
  expect(calls[0]!.inputs.find((item) => item.name === 'label')?.state).toBe('unknown');
  expect(calls[1]!.inputs.find((item) => item.name === 'label')?.value).toBe('same');
  expect(index!.summaries.find((item) => item.inputName === 'label')?.counts.unknown).toBe(1);
  expect(index!.coverage).toBe('partial');
  expect(
    component.componentFacts!.sourceObservations!.inputOutput!.witnesses.some(
      (item) => item.kind === 'returned-value' && item.inputName === 'mode',
    ),
  ).toBe(false);
});
it('records direct call arity and leaves a spread-shifted positional call unknown', async () => {
  const { component } = await fixture(
    `import { Surface } from '@surface'; const params = [] as any; Surface({label:'direct',mode:'a'}); Surface(...params, {label:'shifted',mode:'b'});`,
  );
  const index = component.componentFacts?.sourceObservations?.referenceIndex;
  expect(index).toBeDefined();
  const calls = index!.references.filter((item) => item.kind === 'call');
  expect(calls).toHaveLength(2);
  expect(calls[0]!.arguments[0]!.parameterIndex).toBe(0);
  expect(calls[1]!.arguments.every((item) => item.parameterIndex === null)).toBe(true);
  expect(calls[1]!.reasons).toContain('argument-spread-arity');
});
it('validates strict versioned references and rejects malformed counts, ranges and unknown fields', async () => {
  const { component } = await fixture(`import {Surface} from '@surface'; const sample=<Surface label="ok" mode="a"/>;`);
  expect(api.readSourceReferences).toBeTypeOf('function');
  const index = component.componentFacts!.sourceObservations!.referenceIndex!;
  expect(api.readSourceReferences(index).status).toBe('available');
  expect(api.readSourceReferences({ ...index, schemaVersion: 99 }).status).toBe('unsupported');
  expect(api.readSourceReferences({ ...index, invented: true }).status).toBe('corrupt');
  expect(api.readSourceReferences({ ...index, used: { ...index.used, nodes: -1 } }).status).toBe('corrupt');
  const invalid = structuredClone(index);
  invalid.references[0]!.location.endOffset = -1;
  expect(api.readSourceReferences(invalid).status).toBe('corrupt');
});

it('follows default namespace barrel and immutable computed aliases without name merging', async () => {
  const { component } = await fixture(
    `import Default from './Barrel';import * as Namespace from './Barrel';const key='entry';const values={entry:Default};const Alias=values[key];const a=<Alias label="a" mode="a"/>;const b=<Namespace.Surface label="b" mode="b"/>;`,
    { 'Barrel.ts': `export {Surface,Surface as default} from './Surface';` },
  );
  const index = component.componentFacts!.sourceObservations!.referenceIndex!;
  expect(index.references.filter((reference) => reference.kind === 'jsx')).toHaveLength(2);
  expect(
    new Set(index.references.flatMap((reference) => reference.targets.map((target) => target.declarationId))),
  ).toEqual(new Set([index.componentDeclarationId]));
  expect(index.references.some((reference) => reference.kind === 'reexport')).toBe(true);
  expect(api.readSourceReferences(index).status).toBe('available');
});
it('keeps mutable and injected conditional targets open beside known guarded alternatives', async () => {
  const { component } = await fixture(
    `import {Surface} from '@surface';declare const injected:any;let Mutable=Surface;Mutable=injected;const a=<Mutable label="a" mode="a"/>;const Or=Surface||injected;const Nullish=Surface??injected;const And=Surface&&injected;const b=<Or label="b" mode="b"/>;const c=<Nullish label="c" mode="a"/>;const d=<And label="d" mode="b"/>;`,
  );
  const calls = component.componentFacts!.sourceObservations!.referenceIndex!.references.filter(
    (reference) => reference.kind === 'jsx',
  );
  expect(calls).toHaveLength(4);
  expect(calls[0]!.reasons).toContain('target-mutation-or-mutable-binding');
  expect(calls[1]!.reasons).toContain('target-unsupported-or-no-body');
  expect(calls[2]!.targets[0]!.conditions[0]!.branch).toBe('non-nullish');
  expect(calls[3]!.targets[0]!.conditions[0]!.branch).toBe('falsy');
});
it('invalidates recursive object aliases and destructuring, compound, increment and loop writes', async () => {
  const { component } = await fixture(
    `import {Surface} from '@surface';const object={label:'fixed'};const alias=object;alias.label='changed';let assigned='a',compound='b',increment=1,loop='c';({assigned}= {assigned:'changed'});compound+='changed';increment++;for(loop of ['changed']){};const a=<Surface label={object.label} mode="a"/>;const b=<Surface label={assigned} mode="a"/>;const c=<Surface label={compound} mode="a"/>;const d=<Surface label={increment} mode="a"/>;const e=<Surface label={loop} mode="a"/>;`,
  );
  const calls = component.componentFacts!.sourceObservations!.referenceIndex!.references.filter(
    (reference) => reference.kind === 'jsx',
  );
  expect(calls.every((call) => call.inputs.find((input) => input.name === 'label')?.state === 'unknown')).toBe(true);
});
it('retains method accessor and lowercase callback owners beside top-level sightings', async () => {
  const { component } = await fixture(
    `import {Surface} from '@surface';const object={method(){const lower=()=> <Surface label="callback" mode="a"/>;return null},get member(){return <Surface label="getter" mode="b"/>}};const sighting=<Surface label="top" mode="a"/>;`,
  );
  const calls = component.componentFacts!.sourceObservations!.referenceIndex!.references.filter(
    (reference) => reference.kind === 'jsx',
  );
  expect(calls.map((call) => call.ancestors.length)).toEqual([2, 1, 0]);
  expect(calls[2]!.owner).toBeNull();
});
it('discloses global node and depth budgets without invalid plain records', async () => {
  const f = await fixture(`import {Surface} from '@surface';const a=<Surface label="sample" mode="a"/>;`);
  const result = await api.extractReactComponents([f.selected], undefined, {
    projectRoot: f.root,
    evidenceFilePaths: [f.evidence],
    componentObservationLimits: { maxNodes: 20 },
  });
  const index = result.components[0]!.componentFacts!.sourceObservations!.referenceIndex!;
  expect(index.used.nodes).toBeLessThanOrEqual(20);
  expect(index.omissions.some((item) => item.reason.includes('budget') || item.reason.includes('nodes'))).toBe(true);
  expect(api.readSourceReferences(index).status).toBe('available');
});
it('rejects positive but inconsistent summary counts and fabricated alternate target endpoints', async () => {
  const { component } = await fixture(`import {Surface} from '@surface';const a=<Surface label="sample" mode="a"/>;`);
  const index = component.componentFacts!.sourceObservations!.referenceIndex!;
  const counts = structuredClone(index);
  counts.summaries[0]!.counts.provided++;
  expect(api.readSourceReferences(counts).status).toBe('corrupt');
  const target = structuredClone(index);
  target.references[0]!.targets[0]!.declarationId += 'changed';
  expect(api.readSourceReferences(target).status).toBe('corrupt');
});

it('keeps configured projects with conflicting alias spellings and same-name declarations distinct', async () => {
  const root = mkdtempSync(join(tmpdir(), 'multiple-reference-projects-'));
  roots.push(root);
  const selected: string[] = [],
    evidence: string[] = [];
  for (const name of ['one', 'two']) {
    const directory = join(root, name);
    mkdirSync(directory);
    const component = join(directory, 'Surface.tsx');
    const caller = join(directory, 'Caller.test.tsx');
    writeFileSync(component, `export function Surface(props:{label:string}){return <b>{props.label}</b>}`);
    writeFileSync(caller, `import {Surface} from '@surface';const a=<Surface label="${name}"/>;`);
    writeFileSync(
      join(directory, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { jsx: 'preserve', baseUrl: '.', paths: { '@surface': ['./Surface'] } } }),
    );
    selected.push(component);
    evidence.push(caller);
  }
  const result = await api.extractReactComponents(selected, undefined, {
    projectRoot: root,
    evidenceFilePaths: evidence,
  });
  expect(result.components).toHaveLength(2);
  const indexes = result.components.map((component) => component.componentFacts!.sourceObservations!.referenceIndex!);
  expect(new Set(indexes.map((index) => index.componentDeclarationId)).size).toBe(2);
  for (const index of indexes) {
    expect(index.references.filter((reference) => reference.kind === 'jsx')).toHaveLength(1);
    expect(index.summaries[0]!.samples).toHaveLength(1);
  }
  const repeat = await api.extractReactComponents(selected, undefined, {
    projectRoot: root,
    evidenceFilePaths: evidence,
  });
  expect(repeat.components.map((component) => component.componentFacts!.sourceObservations!.referenceIndex)).toEqual(
    indexes,
  );
});

it('invalidates nested object-property reads when a recursive immutable alias writes their base', async () => {
  const { component } = await fixture(
    `import {Surface} from '@surface';const root={nested:{value:'fixed'}};const alias=root.nested;alias.value='changed';const a=<Surface label={root.nested.value} mode="a"/>;`,
  );
  const input = component
    .componentFacts!.sourceObservations!.referenceIndex!.references.find((reference) => reference.kind === 'jsx')!
    .inputs.find((input) => input.name === 'label')!;
  expect(input.state).toBe('unknown');
  expect(input.reasons).toContain('value-base-mutated');
});
it('keeps type-only references, ordered repeated attributes and export-star edges separate from effective callers', async () => {
  const { component } = await fixture(
    `import {Surface} from './Top';type Ref=typeof Surface;let target=Surface;target=Surface;const a=<Surface label="first" label="last" {...{mode:'a'}}/>;`,
    { 'Top.ts': `export * from './Barrel';`, 'Barrel.ts': `export {Surface} from './Surface';` },
  );
  const index = component.componentFacts!.sourceObservations!.referenceIndex!;
  const call = index.references.find((reference) => reference.kind === 'jsx')!;
  expect(index.references.some((reference) => reference.kind === 'type')).toBe(true);
  expect(index.references.some((reference) => reference.kind === 'assignment')).toBe(true);
  expect(call.history.filter((input) => input.name === 'label').map((input) => input.value)).toEqual(['first', 'last']);
  expect(
    index.summaries.find((summary) => summary.inputName === 'label')!.samples.map((sample) => sample.value),
  ).toEqual(['last']);
  expect(index.summaries.find((summary) => summary.inputName === 'label')!.counts.provided).toBe(1);
});
