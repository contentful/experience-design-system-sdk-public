import { describe, expect, it } from 'vitest';
import { collectStandaloneSourceCallSiteEvidence as collectSourceCallSiteEvidence } from '../../../src/steps/composition/src/helpers/edges/source-call-site-evidence.js';
import type { RawComponentDefinition } from '../../../src/index.js';

const child: RawComponentDefinition = {
  name: 'Child',
  source: '/example/Child.tsx',
  framework: 'react',
  props: [
    { name: 'label', type: 'string', required: false },
    { name: 'count', type: 'number', required: false },
    { name: 'absent', type: 'string', required: false },
  ],
  slots: [],
};
const parent: RawComponentDefinition = {
  name: 'Parent',
  source: '/example/Parent.tsx',
  framework: 'react',
  props: [],
  slots: [],
};
const definition = { path: child.source, content: 'export const Child = (props: unknown) => null;' };
const collect = (body: string, extra: Array<{ path: string; content: string }> = []) =>
  collectSourceCallSiteEvidence(
    [
      definition,
      { path: parent.source, content: `import {Child as Target} from './Child'; const Alias=Target; ${body}` },
      ...extra,
    ],
    [parent, child],
  );

describe('generic caller input observations', () => {
  it('retains supplied literal/empty/omitted properties and text with resolved alias identity', () => {
    const result = collect(
      'const label="source text"; export const Parent=()=> <Alias label={label} count={0} slot="headline">Body text</Alias>;',
    );
    expect(result.accepted).toHaveLength(1);
    const observation = result.accepted[0]!;
    expect(observation).toMatchObject({
      child: 'Child',
      childSourcePath: child.source,
      parentSourcePath: parent.source,
      execution: 'lexical-reference',
    });
    expect(observation.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'property', name: 'label', state: 'text', value: 'source text' }),
        expect.objectContaining({ kind: 'property', name: 'count', state: 'supplied', value: 0 }),
        expect.objectContaining({ kind: 'property', name: 'slot', state: 'text', value: 'headline' }),
        expect.objectContaining({ kind: 'property', name: 'absent', state: 'omitted' }),
        expect.objectContaining({ kind: 'children', state: 'text', value: 'Body text' }),
      ]),
    );
    expect(observation).not.toHaveProperty('slot');
    expect(observation.inputs!.every((input) => input.startLine > 0 && input.endLine >= input.startLine)).toBe(true);
  });

  it('distinguishes omitted, explicitly empty, null and unresolved caller syntax', () => {
    const result = collect(
      'export const Parent=()=> <><Alias/><Alias></Alias><Alias label={null}>{null}</Alias><Alias label={dynamic}>{dynamic}</Alias></>;',
    );
    const observations = [...result.accepted].sort((a, b) => a.startOffset! - b.startOffset!);
    expect(observations.map((o) => o.inputs!.find((i) => i.kind === 'children')!.state)).toEqual([
      'omitted',
      'empty',
      'empty',
      'unknown',
    ]);
    expect(observations[2]!.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'property', name: 'label', state: 'empty', value: null }),
      ]),
    );
    expect(observations[3]!.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'property', name: 'label', state: 'unknown', expression: 'dynamic' }),
      ]),
    );
  });

  it('retains nested and callback JSX context without promoting named attributes into slots', () => {
    const result = collect('export const Parent=()=> <Alias renderBody={()=> <Alias slot="named"/>}><Alias/></Alias>;');
    expect(result.accepted).toHaveLength(3);
    expect(
      result.accepted.some((o) =>
        o.inputs!.some((i) => i.name === 'renderBody' && i.state === 'supplied' && i.representation === 'callback'),
      ),
    ).toBe(true);
    expect(result.accepted.filter((o) => o.context!.length > 0)).toHaveLength(2);
    expect(result.accepted.every((o) => !Object.hasOwn(o, 'slot'))).toBe(true);
  });

  it('handles inline spread precedence and unknown spreads without false omissions', () => {
    const result = collect(
      'export const Parent=()=> <><Alias {...{label:"inline",count:2}}/><Alias label="before" {...unknown} count={3}/></>;',
    );
    const [first, second] = [...result.accepted].sort((a, b) => a.startOffset! - b.startOffset!);
    expect(first!.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'label', state: 'text', value: 'inline' }),
        expect.objectContaining({ name: 'count', value: 2 }),
      ]),
    );
    expect(second!.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'label', state: 'unknown' }),
        expect.objectContaining({ name: 'count', state: 'supplied', value: 3 }),
        expect.objectContaining({ name: 'absent', state: 'unknown' }),
      ]),
    );
    expect(second!.inputs!.filter((i) => i.kind === 'spread')).toEqual([
      expect.objectContaining({ state: 'unknown', expression: 'unknown' }),
    ]);
  });

  it('qualifies missing callers by admitted coverage and unresolved or unsupported source', () => {
    const clean = collect('export const Parent=()=>null;');
    expect(clean.coverage).toMatchObject({
      scope: 'admitted-source',
      coverage: 'partial',
      components: expect.arrayContaining([
        expect.objectContaining({
          name: 'Child',
          sourcePath: child.source,
          referenceCount: 0,
          outcome: 'not-observed',
        }),
      ]),
    });
    const uncertain = collect('export const Parent=(Alias:unknown)=><Alias/>;', [
      { path: '/example/Unsupported.vue', content: '<template><Child/></template>' },
    ]);
    expect(uncertain.accepted).toEqual([]);
    expect(uncertain.coverage).toMatchObject({
      unresolvedReferences: 1,
      files: expect.arrayContaining([
        expect.objectContaining({ path: '/example/Unsupported.vue', status: 'unsupported' }),
      ]),
      components: expect.arrayContaining([expect.objectContaining({ name: 'Child', outcome: 'unknown' })]),
    });
    expect(child.props).toHaveLength(3);
    expect(child.slots).toEqual([]);
  });

  it('retains mixed text and unresolved child parts independently', () => {
    const result = collect('export const Parent=()=> <Alias>Prefix{dynamic}<Alias/></Alias>;');
    const body = result.accepted.find((o) => o.context!.length === 0)!.inputs!.find((i) => i.kind === 'children')!;
    expect(body.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: 'text', value: 'Prefix' }),
        expect.objectContaining({ state: 'unknown', expression: 'dynamic' }),
        expect.objectContaining({ state: 'supplied', representation: 'jsx' }),
      ]),
    );
  });

  it('binds constant and enum values to their admitted declaration ranges', () => {
    const result = collect(
      "import {caption,Mode} from './values'; export const Parent=()=> <Alias label={caption} count={Mode.High}/>;",
      [{ path: '/example/values.ts', content: 'export const caption="declared"; export enum Mode {High=1_000}' }],
    );
    expect(result.accepted[0]!.inputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'label',
          value: 'declared',
          valueSource: expect.objectContaining({
            sourcePath: '/example/values.ts',
            startLine: 1,
            sourceTextHash: expect.any(String),
          }),
        }),
        expect.objectContaining({
          name: 'count',
          value: 1000,
          valueSource: expect.objectContaining({ sourcePath: '/example/values.ts' }),
        }),
      ]),
    );
  });

  it('keeps asserted, cyclic, mutable and nonliteral spread values unknown', () => {
    const result = collect(
      'const asserted=dynamic as "literal"; const a=b; const b=a; let mutable="initial"; const options={label:"initial"}; export const Parent=()=> <><Alias label={asserted} count={a}/><Alias label={mutable} {...options}/></>;',
    );
    expect(
      result.accepted
        .flatMap((o) => o.inputs!.filter((i) => i.kind === 'property' && ['label', 'count'].includes(i.name!)))
        .every((i) => i.state === 'unknown'),
    ).toBe(true);
  });

  it('reports ambiguous bindings and calls outside admitted owners without inventing relationships', () => {
    const files = [
      definition,
      {
        path: parent.source,
        content: "import {Child} from './Child'; const outside=()=> <Child/>; export const Parent=()=> <Child/>;",
      },
    ];
    const result = collectSourceCallSiteEvidence(files, [parent, child, { ...child }]);
    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([expect.objectContaining({ reason: 'ambiguous-component' })]);
    expect(result.coverage).toMatchObject({
      unownedReferences: 1,
      components: expect.arrayContaining([expect.objectContaining({ name: 'Child', outcome: 'unknown' })]),
    });
  });
});
