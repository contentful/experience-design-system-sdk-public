import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import * as api from '../../../../../src/steps/extraction/index.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
async function extract(text: string, files: Record<string, string> = {}, options: api.ExtractorOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'input-output-'));
  directories.push(root);
  const path = join(root, 'Surface.tsx');
  writeFileSync(path, text);
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(root, name), contents);
  const result = await api.extractReactComponents([path], undefined, { projectRoot: root, ...options });
  const component = result.components.find((item) => item.name === 'Surface')!;
  const collection = component.componentFacts!.sourceObservations!;
  const evidence = collection.inputOutput;
  expect(evidence).toBeDefined();
  return { component, evidence: evidence! };
}
it('reads renamed returned inputs, immutable aliases and distinct intrinsic destinations in the default producer', async () => {
  const { evidence } = await extract(`
function Last({ final }: { final: string }) { return <em>{final}</em>; }
function Middle({ renamed }: { renamed: string }) { return <Last final={renamed} />; }
export function Surface({ unusual: original, gate }: { unusual: string; gate: boolean }) {
  const first = original; const second = first;
  return <section title={second} data-label={gate ? second : 'fixed'}><Middle renamed={second} /></section>;
}`);
  expect(evidence.inputs.map((item) => item.name)).toEqual(['gate', 'unusual']);
  expect(evidence.witnesses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        inputName: 'unusual',
        kind: 'intrinsic-attribute',
        destination: expect.objectContaining({ inputName: 'title' }),
      }),
      expect.objectContaining({
        inputName: 'unusual',
        kind: 'intrinsic-attribute',
        destination: expect.objectContaining({ inputName: 'data-label' }),
      }),
      expect.objectContaining({ inputName: 'unusual', kind: 'returned-value', context: 'returned' }),
    ]),
  );
  expect(evidence.summaries.find((item) => item.inputName === 'gate')?.state).toBe('absent');
});
it('distinguishes constants, discarded and deferred source from actual returned witnesses', async () => {
  const { evidence } = await extract(`
function Ignore(value: string) { return 'fixed'; }
function Receiver({ children }: { children: unknown }) { return <aside />; }
export function Surface(props: { unseen: string; pending: string }) {
  const unused = <b>{props.unseen}</b>;
  const callback = () => <i>{props.pending}</i>;
  return <Receiver><span>{Ignore(props.unseen)}</span></Receiver>;
}`);
  expect(
    evidence.witnesses.some(
      (item) => item.inputName === 'unseen' && item.kind === 'returned-value' && item.context === 'returned',
    ),
  ).toBe(false);
  expect(evidence.witnesses.some((item) => item.context === 'discarded')).toBe(true);
  expect(evidence.witnesses.some((item) => item.context === 'deferred')).toBe(true);
});
it('uses effective computed values and last spread writes while conserving source inputs', async () => {
  const { component, evidence } = await extract(`
const arbitrary = 'title'; const next = arbitrary;
export function Surface(props: { original: string; replacement: string; broad?: unknown }) {
  const attrs = { [next]: props.original, ...{ title: 'constant' }, title: props.replacement };
  return <section {...attrs} />;
}`);
  expect(
    evidence.witnesses.filter((item) => item.kind === 'intrinsic-attribute').map((item) => item.inputName),
  ).toEqual(['replacement']);
  expect(component.sourceCandidates?.map((item) => item.name)).toEqual(
    expect.arrayContaining(['original', 'replacement', 'broad']),
  );
});
it.each([
  'current = other',
  'current += other',
  'current++',
  '({ current } = object)',
  '[current] = values',
  'for (current of values) {}',
])('invalidates actual declaration writes: %s', async (write) => {
  const { evidence } = await extract(`export function Surface(props: { input: string }) {
let current = props.input; let other: any; let object: any; let values: any; ${write}; return <span>{current}</span>;
}`);
  expect(evidence.summaries.find((item) => item.inputName === 'input')?.state).toBe('open');
});
it('retains separate guard alternatives and never invents a children slot for mapped data', async () => {
  const { component, evidence } = await extract(`function Item({ label }: { label: string }) { return <b>{label}</b>; }
export function Surface(props: { input: string; gate: boolean; rows: string[] }) {
  const alias = props.input;
  return <section title={props.gate ? alias : 'fixed'} data-label={props.gate ? 'fixed' : alias}>{props.rows.map((label) => <Item label={label} />)}</section>;
}`);
  const witnesses = evidence.witnesses as Array<{
    inputName: string;
    kind: string;
    conditions?: Array<{ branch: string }>;
  }>;
  expect(
    witnesses
      .filter((item) => item.inputName === 'input' && item.kind === 'intrinsic-attribute')
      .flatMap((item) => item.conditions?.map((condition) => condition.branch) ?? []),
  ).toEqual(expect.arrayContaining(['truthy', 'falsy']));
  expect(component.slots.some((slot) => slot.name === 'children')).toBe(false);
});
it('keeps known receiver branches and exact rest origins beside injected destinations and unknown overwrites', async () => {
  const { evidence } = await extract(`function Known({ renamed }: { renamed: string }) { return <b>{renamed}</b>; }
export function Surface({ input, gate, injected, ...rest }: { input: string; secondary: string; gate: boolean; injected: any }) {
  const Receiver = gate ? Known : injected;
  const Native = 'section';
  return <Native data-known={input}><Receiver renamed={input} /><i title={rest.secondary} />{injected(rest.secondary)}</Native>;
}`);
  expect(evidence.summaries.find((item) => item.inputName === 'input')?.state).toBe('positive');
  expect(evidence.witnesses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        inputName: 'input',
        kind: 'intrinsic-attribute',
        destination: expect.objectContaining({ name: 'section', inputName: 'data-known' }),
      }),
      expect.objectContaining({
        inputName: 'secondary',
        kind: 'intrinsic-attribute',
        destination: expect.objectContaining({ inputName: 'title' }),
      }),
    ]),
  );
  expect(
    evidence.witnesses
      .filter(
        (item) =>
          item.inputName === 'input' &&
          item.context === 'returned' &&
          item.enclosing.some((destination) => destination.kind === 'callable'),
      )
      .flatMap((item) => item.conditions.map((condition) => condition.branch)),
  ).toContain('truthy');
});
it('retains effective known assignments after an unknown spread without upgrading overwritten inputs', async () => {
  const { evidence } = await extract(`export function Surface(props: { old: string; known: string; unknown: any }) {
  const attributes = { title: props.old, ...props.unknown, 'data-stable': props.known };
  return <section {...attributes} />;
}`);
  expect(evidence.witnesses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        inputName: 'known',
        kind: 'intrinsic-attribute',
        strength: 'inferred',
        destination: expect.objectContaining({ inputName: 'data-stable' }),
      }),
      expect.objectContaining({ inputName: 'old', strength: 'unknown' }),
    ]),
  );
});
it('distinguishes void intrinsic child consumption from source-declared children and symbol-resolved components', async () => {
  const { component, evidence } =
    await extract(`function Input(props: { children: unknown }) { return <span>{props.children}</span>; }
export function Surface(props: { children: unknown }) { return <input {...props} />; }`);
  expect(evidence.summaries.find((item) => item.inputName === 'children')?.state).toBe('absent');
  expect(component.sourceCandidates?.map((candidate) => candidate.name)).toContain('children');
  const control = await extract(`function Input(props: { children: unknown }) { return <span>{props.children}</span>; }
export function Surface(props: { children: unknown }) { return <Input {...props} />; }`);
  expect(control.evidence.summaries.find((item) => item.inputName === 'children')?.state).toBe('positive');
});

it.each([
  '({ alias: current } = object)',
  '({ nest: { alias: current } } = object)',
  '({ current = other } = object)',
  '([...current] = values)',
  '({ ...current } = object)',
  'for ({ current } of values) {}',
  'for ({ current = other } in object) {}',
])('invalidates nested/default/rest/loop writes: %s', async (write) => {
  const { evidence } = await extract(
    `export function Surface(props: { input: string }) { let current: any = props.input; let other: any; let object: any; let values: any; ${write}; return <span>{current}</span>; }`,
  );
  expect(evidence.summaries.find((item) => item.inputName === 'input')?.state).toBe('open');
});
it.each(['({ current } = object)', '({ current = other } = object)', 'for ({ current } of values) {}'])(
  'invalidates actual callable shorthand writes: %s',
  async (write) => {
    const { component, evidence } = await extract(
      `export function Surface(props: { children: unknown }) { let current = (props: { children: unknown }) => <aside />; let other: any; let object: any; let values: any; ${write}; const Receiver = current; return <Receiver {...props} />; }`,
    );
    expect(evidence.summaries.find((item) => item.inputName === 'children')?.state).toBe('open');
    expect(component.sourceCandidates?.map((item) => item.name)).toContain('children');
  },
);
it('keeps shadowed and unrelated writes distinct from the returned callable/value binding', async () => {
  const { evidence } = await extract(
    `export function Surface(props: { input: string }) { const current = props.input; const Receiver = (props: { supplied: string }) => <span>{props.supplied}</span>; { let current: any; let Receiver: any; let object: any; ({ current, Receiver } = object); } let other: any; other++; return <Receiver supplied={current} />; }`,
  );
  expect(evidence.summaries.find((item) => item.inputName === 'input')?.state).toBe('positive');
});
it('uses literal/template/numeric/imported initializer key values and keeps dynamic keys open', async () => {
  const { evidence } = await extract(
    `import { key as imported } from './keys'; const suffix = 'label'; const computed = \`data-\${suffix}\`; const asserted = 'actual' as 'invented';
export function Surface(props: { first: string; second: string; numeric: string; actual: string; dynamic: string; key: string }) { const attrs = { [imported]: props.first, [computed]: props.second, [2]: props.numeric, [asserted]: props.actual }; return <section {...attrs}><b {...{ [props.key]: props.dynamic }} /></section>; }`,
    { 'keys.ts': "export const key = 'title';" },
  );
  for (const [inputName, name] of [
    ['first', 'title'],
    ['second', 'data-label'],
    ['numeric', '2'],
    ['actual', 'actual'],
  ])
    expect(evidence.witnesses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          inputName,
          kind: 'intrinsic-attribute',
          destination: expect.objectContaining({ inputName: name }),
        }),
      ]),
    );
  expect(evidence.summaries.find((item) => item.inputName === 'dynamic')?.state).toBe('open');
});
it.each(['section', 'custom-element', 'html', 'body'])('uses parser child survival with intrinsic %s', async (name) => {
  const { evidence } = await extract(
    `export function Surface(props: { children: unknown }) { return <${name} {...props} />; }`,
  );
  expect(evidence.summaries.find((item) => item.inputName === 'children')?.state).toBe('positive');
});
it('preserves exact whole/rest/alias origins and ordered children replacement', async () => {
  const first = await extract(
    `function Receiver(props: { children: unknown }) { return <span>{props.children}</span>; } export function Surface({ children: supplied, ...rest }: { children: unknown; label: string }) { const attrs = { ...rest, children: supplied }; return <Receiver {...attrs} />; }`,
  );
  expect(first.evidence.summaries.find((item) => item.inputName === 'children')?.state).toBe('positive');
  const second = await extract(
    `export function Surface(props: { children: unknown }) { const other = { children: 'fixed' }; return <section {...props} {...other}>{'replacement'}</section>; }`,
  );
  expect(second.evidence.summaries.find((item) => item.inputName === 'children')?.state).toBe('absent');
});
it('keeps declaration-only and recursive receivers open while preserving known positive sinks', async () => {
  const { component, evidence } = await extract(
    `import { Unavailable } from './receiver'; function Recursive(props: { input: string; gate: boolean }) { return props.gate ? <Recursive {...props} /> : <b>{props.input}</b>; } export function Surface(props: { input: string; gate: boolean; children: unknown }) { return <section><Recursive input={props.input} gate={props.gate}/><Unavailable children={props.children}/></section>; }`,
    { 'receiver.d.ts': 'export declare function Unavailable(props: { children: unknown }): unknown;' },
  );
  expect(evidence.summaries.find((item) => item.inputName === 'input')?.state).toBe('positive');
  expect(evidence.summaries.find((item) => item.inputName === 'children')?.state).toBe('open');
  expect(evidence.omissions.map((item) => item.reason)).toEqual(
    expect.arrayContaining(['recursive-output-open', 'declaration-body-unavailable']),
  );
  expect(component.sourceCandidates?.map((item) => item.name)).toContain('children');
});
it('reports explicit depth/node/witness bounds without deleting source inputs', async () => {
  for (const componentObservationLimits of [{ maxDepth: 1 }, { maxNodes: 3 }, { maxObservations: 1 }]) {
    const { component, evidence } = await extract(
      `export function Surface(props: { input: string; other: string }) { return <section title={props.input} data-label={props.other}>{props.input}</section>; }`,
      {},
      { componentObservationLimits },
    );
    expect(evidence.coverage).toBe('partial');
    expect(evidence.omissions.length).toBeGreaterThan(0);
    expect(component.sourceCandidates?.map((item) => item.name)).toEqual(expect.arrayContaining(['input', 'other']));
  }
});
it('conserves broad declared shapes/defaults and does not change evidence semantics with input/type spelling', async () => {
  for (const [typeName, inputName] of [
    ['ReactNode', 'children'],
    ['UnknownPayload', 'unusual'],
  ]) {
    const { component, evidence } = await extract(
      `type ${typeName} = string | number | null | ReadonlyArray<{ nested: string; optional?: number }>; export function Surface({ ${inputName} = null, rows, callback }: { ${inputName}?: ${typeName}; rows: ReadonlyArray<{ required: string; optional?: number }>; callback: () => unknown }) { return <section title={rows[0].required}/>; }`,
    );
    const candidate = component.sourceCandidates!.find((item) => item.name === inputName)!;
    expect(candidate.facts?.sourceTypeText).toBeDefined();
    expect(candidate.facts?.sourceDefault?.expression).toBe('null');
    expect(candidate.declaredRequired).toBe(false);
    const rows = component.sourceCandidates!.find((item) => item.name === 'rows')!;
    expect(rows.declaredRequired).toBe(true);
    expect(rows.facts?.sourceGraph?.nodes.flatMap((node) => node.fields ?? [])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'required', required: true }),
        expect.objectContaining({ key: 'optional', required: false }),
      ]),
    );
    expect(component.sourceCandidates?.map((item) => item.name)).toEqual(
      expect.arrayContaining([inputName, 'rows', 'callback']),
    );
    expect(evidence.summaries.find((item) => item.inputName === inputName)?.scope).toBe('component-return');
  }
});

it('retains known assignments beside an unresolved shorthand value', async () => {
  const { evidence } = await extract(
    `export function Surface(props: { input: string }) { const attrs = { missing, title: props.input }; return <section {...attrs} />; }`,
  );
  expect(evidence.summaries.find((item) => item.inputName === 'input')?.state).toBe('positive');
  expect(evidence.omissions.map((item) => item.reason)).toContain('value-declaration-unavailable');
});

it.each([
  '<input><span>{props.input}</span></input>',
  '<section children={<span>{props.input}</span>}>replacement</section>',
  '<section {...{ children: <span>{props.input}</span> }} children="replacement" />',
])('does not promote nested JSX from a discarded effective child: %s', async (output) => {
  const { component, evidence } = await extract(
    `export function Surface(props: { input: string }) { return ${output}; }`,
  );
  expect(evidence.summaries.find((item) => item.inputName === 'input')?.state).toBe('absent');
  expect(
    evidence.witnesses.some(
      (item) =>
        item.inputName === 'input' &&
        item.context === 'returned' &&
        item.kind !== 'receiver-input' &&
        item.kind !== 'guard',
    ),
  ).toBe(false);
  expect(component.sourceCandidates?.map((item) => item.name)).toContain('input');
});
it('retains nested input dependency when the effective intrinsic child survives', async () => {
  const { evidence } = await extract(
    `export function Surface(props: { input: string }) { return <section><span>{props.input}</span></section>; }`,
  );
  expect(evidence.summaries.find((item) => item.inputName === 'input')?.state).toBe('positive');
});
