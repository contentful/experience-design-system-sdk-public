import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Project } from 'ts-morph';
import { afterEach, describe, expect, it } from 'vitest';
import * as api from '../../src/index.js';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function fixture(text: string, files: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'component-observations-'));
  directories.push(root);
  for (const [path, content] of Object.entries({ 'Panel.tsx': text, ...files })) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return { root, path: join(root, 'Panel.tsx') };
}
async function observations(text: string, options: Partial<api.ExtractorOptions> = {}) {
  const { root, path } = fixture(text);
  const component = (await api.extractReactComponents([path], undefined, { projectRoot: root, ...options }))
    .components[0]!;
  expect(component.componentFacts?.sourceObservations).toBeDefined();
  return { component, collection: component.componentFacts!.sourceObservations!, root, path };
}
const source = `type Props = { 'a.b': string; a: { b: string }; 'x/y': string; '[]': string; mode: 'short' | 'long' };
function readValue(value: string) { return value; }
export function Panel(props: Props) {
 const { 'a.b': renamed, ...rest } = props;
 const alias = props.a;
 let mutable = props['x/y']; mutable = 'changed';
 if (props.mode !== 'short') { readValue(renamed); }
 const result = readValue(props.a.b);
 const deferred = () => readValue(alias.b);
 const dynamic = props[result];
 Math.max(1, 2);
 return <div>{result}{props['[]']}{rest['a.b']}{mutable}{deferred()}</div>;
}
Panel.Item = readValue;
Object.assign(Panel, { Other: readValue });`;

describe('generic component source observations', () => {
  it('collects non-empty default facts while keeping declared candidates and authoring fields independent', async () => {
    const { component, collection } = await observations(source);
    expect(collection.observations.map((observation) => observation.kind)).toEqual(
      expect.arrayContaining([
        'declaration',
        'binding',
        'call',
        'comparison',
        'return',
        'assignment',
        'member-read',
        'jsx',
      ]),
    );
    expect(component.componentFacts?.renderables).toBeUndefined();
    expect(component.componentFacts?.requiresParent).toBeUndefined();
    expect(component.componentFacts?.nonStatic).toBeUndefined();
    expect(component.sourceCandidates?.find((candidate) => candidate.name === 'mode')).toMatchObject({
      declaredRequired: true,
      facts: { sourceTypeText: "'short' | 'long'", domain: { openness: 'closed' } },
    });
    expect(collection.observations.some((observation) => observation.candidateKeyPath?.[0] === 'mode')).toBe(true);
  });

  it('preserves opaque keys, aliases, shadows, mutable aliases, rest and unresolved computed access', async () => {
    const { collection } = await observations(source);
    const paths = collection.observations
      .flatMap((observation) => [
        observation.inputPath,
        ...(observation.operands ?? []).map((operand) => operand.inputPath),
      ])
      .filter(Boolean);
    expect(paths.map((path) => path!.segments)).toEqual(
      expect.arrayContaining([
        [{ kind: 'field', name: 'a.b' }],
        [
          { kind: 'field', name: 'a' },
          { kind: 'field', name: 'b' },
        ],
        [{ kind: 'field', name: 'x/y' }],
        [{ kind: 'field', name: '[]' }],
      ]),
    );
    expect(paths.some((path) => path!.segments.some((segment) => segment.kind === 'rest'))).toBe(true);
    expect(collection.omissions.map((omission) => omission.reason)).toEqual(
      expect.arrayContaining(['computed-key-unresolved', 'mutable-alias', 'rest-path-partial']),
    );
    const shadowed = await observations(
      `type Props = { label: string }; export function Panel(props: Props) { const label = props.label; const closure = () => { const label = 'local'; return label; }; return <div>{label}{closure()}</div>; }`,
    );
    const labels = shadowed.collection.observations.filter(
      (observation) => observation.kind === 'binding' && observation.subject?.name === 'label',
    );
    expect(new Set(labels.map((observation) => observation.subject?.id)).size).toBe(2);
  });

  it('retains call sites, arguments, signature positions, result uses, conditions and deferred lexical execution', async () => {
    const { collection } = await observations(source);
    const calls = collection.observations.filter(
      (observation) => observation.kind === 'call' && observation.expression?.startsWith('readValue'),
    );
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(new Set(calls.map((call) => call.id)).size).toBe(calls.length);
    expect(calls.map((call) => call.resultUse?.kind)).toEqual(expect.arrayContaining(['discarded', 'initializer']));
    expect(calls.some((call) => call.context.execution === 'deferred')).toBe(true);
    expect(calls.some((call) => call.context.conditions.some((condition) => condition.branch === 'then'))).toBe(true);
    expect(calls[0]?.operands?.some((operand) => operand.role === 'argument' && operand.index === 0)).toBe(true);
    expect(calls[0]?.type?.signatures?.[0]?.parameters?.[0]?.typeText).toBe('string');
    const library = collection.observations.find(
      (observation) => observation.kind === 'call' && observation.expression === 'Math.max(1, 2)',
    );
    expect(library?.subject?.defaultLibrary).toBe(true);
    expect(
      collection.observations.some(
        (observation) => observation.context.execution === 'referenced-body' && observation.kind === 'return',
      ),
    ).toBe(true);
  });

  it.each(['makeReader()', '(makeReader())'])(
    'does not report call result %s used as a callee as an argument',
    async (callee) => {
      const { component, collection } = await observations(
        `declare function makeReader(): (value: string) => string; type Props = { label: string }; export function Panel(props: Props) { return <div>{${callee}(props.label)}</div>; }`,
      );
      const factory = collection.observations.find((observation) => observation.expression === 'makeReader()');
      expect(factory?.resultUse).toMatchObject({ kind: 'expression', parentKind: 'CallExpression' });
      expect(component.sourceCandidates?.find((candidate) => candidate.name === 'label')).toBeDefined();
    },
  );

  it.each(['===', '!==', '==', '!='])(
    'retains %s polarity, assignments, annotations and lexical throws without declaring mandatory parents',
    async (operator) => {
      const { component, collection } = await observations(
        `type Props = { state: 'ready' | 'waiting' }; /** @slot content descriptive text */ export function Panel(props: Props) { if (props.state ${operator} 'ready') { throw new Error('example'); } return <div/>; } Panel.Value = 'example'; Object.assign(Panel, { Label: 'value' });`,
      );
      expect(collection.observations.find((observation) => observation.kind === 'comparison')?.operator).toBe(operator);
      expect(
        collection.observations.some(
          (observation) => observation.kind === 'annotation' && observation.expression?.includes('@slot'),
        ),
      ).toBe(true);
      expect(
        collection.observations.some(
          (observation) => observation.kind === 'throw' && observation.context.conditions.length > 0,
        ),
      ).toBe(true);
      expect(
        collection.observations.some(
          (observation) => observation.kind === 'assignment' && observation.expression?.includes('Panel.Value'),
        ),
      ).toBe(true);
      expect(component.sourceCandidates?.[0]?.facts?.domain.observedLiterals).toHaveLength(2);
      expect(component.componentFacts?.requiresParent).toBeUndefined();
    },
  );

  it.each([{ maxNodes: 2 }, { maxDepth: 1 }, { maxReferences: 0 }, { maxDeclarations: 0 }])(
    'records deterministic omissions when forced limits are %j',
    async (limits) => {
      const { collection } = await observations(source, { componentObservationLimits: limits });
      expect(collection.coverage).toBe('partial');
      expect(collection.omissions.length).toBeGreaterThan(0);
      for (const [name, value] of Object.entries(limits))
        expect(collection.used[name as keyof typeof collection.used]).toBeLessThanOrEqual(value!);
    },
  );

  it('uses selected file and compiler declaration identity through barrels/aliases and workspace symlinks', async () => {
    const { root, path } = fixture(
      `import { renamed } from './barrel'; type Props = { label: string }; export function Panel(props: Props) { return <div>{renamed(props.label)}</div>; }`,
      {
        'barrel.ts': "export { helper as renamed } from './linked/value';",
        'workspace/value.ts': 'export function helper(value: string) { return value; }',
        'workspace/package.json': JSON.stringify({ name: 'example-package', private: true }),
      },
    );
    symlinkSync(join(root, 'workspace'), join(root, 'linked'));
    const component = (await api.extractReactComponents([path], undefined, { projectRoot: root })).components[0]!;
    const call = component.componentFacts?.sourceObservations?.observations.find(
      (observation) => observation.kind === 'call',
    );
    expect(call?.subject?.resolution).toBe('resolved');
    expect(call?.subject?.declarations?.[0]?.origin).toMatchObject({
      selected: 'outside',
      repository: 'inside',
      realpathStatus: 'resolved',
      package: { name: 'example-package', private: true, publication: 'unknown' },
    });
    expect(call?.subject?.aliases.length).toBeGreaterThan(0);
  });

  it('keeps unavailable declarations/origins conservative and exposes a JSON-only shared collector', async () => {
    const { collection } = await observations(
      `type Props = { label: unknown }; export function Panel(props: Props) { missingValue(props.label); return <div/>; }`,
    );
    expect(collection.omissions.some((omission) => omission.reason === 'symbol-unresolved')).toBe(true);
    const unresolved = collection.observations.find((observation) => observation.kind === 'call');
    expect(unresolved?.subject?.resolution).toBe('unresolved');
    expect(JSON.parse(JSON.stringify(collection))).toEqual(collection);
    const project = new Project({ useInMemoryFileSystem: true });
    const file = project.createSourceFile('/virtual/value.ts', 'export function Plain() { return 1; }');
    const direct = api.collectComponentSourceObservations(file.getFunctions()[0]!, {
      selectedSourcePaths: ['/virtual/value.ts'],
    });
    expect(direct.observations[0]?.subject?.declarations?.[0]?.origin.realpathStatus).toBe('unavailable');
  });

  it('retains resolved generic signatures and call/result positions without narrowing declared alternatives', async () => {
    const { component, collection } = await observations(
      `function read<T>(value: T): T { return value; } type Props = { mode: 'short' | 'long' }; export function Panel(props: Props) { const closure = () => read(props.mode); if (read(props.mode)) { read(read(props.mode)); } return <div>{closure()}</div>; }`,
    );
    const calls = collection.observations.filter(
      (observation) => observation.kind === 'call' && observation.expression.startsWith('read'),
    );
    expect(calls.map((call) => call.resultUse?.kind)).toEqual(
      expect.arrayContaining(['returned', 'condition', 'argument', 'discarded']),
    );
    expect(calls[0]?.type?.resolvedSignature?.parameters[0]?.typeText).toContain('short');
    expect(calls[0]?.type?.resultTypeText).toContain('long');
    expect(component.sourceCandidates?.[0]?.facts?.domain.observedLiterals).toHaveLength(2);
  });

  it('binds every nested default location without mutating source observations', async () => {
    const { component, collection } = await observations(source);
    function locations(value: unknown): api.SourceFactLocation[] {
      if (!value || typeof value !== 'object') return [];
      if ('binding' in value && 'canonicalPath' in value) return [value as api.SourceFactLocation];
      return Object.values(value).flatMap(locations);
    }
    const original = locations(collection);
    expect(original.length).toBeGreaterThan(20);
    const paths = [...new Map(original.map((location) => [location.canonicalPath!, location.textHash])).entries()];
    for (const [captured, expected] of [
      [paths.map(([canonicalPath, textHash]) => ({ canonicalPath, textHash })), 'verified'],
      [paths.map(([canonicalPath]) => ({ canonicalPath, textHash: 'changed' })), 'changed'],
      [paths.map(([canonicalPath]) => ({ canonicalPath, textHash: null })), 'unverified'],
      [[], 'unavailable'],
    ] as const) {
      const bound = api.bindSourceCandidatesToCapture([component], captured)[0]!.componentFacts!.sourceObservations!;
      const boundLocations = locations(bound);
      expect(boundLocations.length).toBe(original.length);
      expect(boundLocations.every((location) => location.binding === expected)).toBe(true);
    }
    expect(original.every((location) => location.binding === 'unverified')).toBe(true);
  });

  it('marks reassigned component input roots as partial instead of asserting an unchanged alias', async () => {
    const { collection } = await observations(
      `type Props = { label: string }; export function Panel(props: Props) { props = { label: 'replacement' }; return <div>{props.label}</div>; }`,
    );
    const read = collection.observations.find(
      (observation) => observation.kind === 'member-read' && observation.expression === 'props.label',
    );
    expect(read?.inputPath).toMatchObject({ certainty: 'ambiguous', reason: 'parameter-reassigned' });
    expect(collection.omissions.some((omission) => omission.reason === 'parameter-reassigned')).toBe(true);
  });

  it.each([
    ['label', 'label'],
    ['label: renamed', 'renamed'],
  ])('marks reassigned destructured parameter %s as partial', async (binding, name) => {
    const { component, collection } = await observations(
      `declare function readValue(value: string): string; type Props = { label: string }; export function Panel({ ${binding} }: Props) { ${name} = 'replacement'; return <div>{readValue(${name})}</div>; }`,
    );
    const call = collection.observations.find((observation) => observation.kind === 'call');
    const argument = call?.operands?.find((operand) => operand.role === 'argument');
    expect(argument?.inputPath).toMatchObject({ certainty: 'ambiguous', reason: 'parameter-reassigned' });
    expect(collection.coverage).toBe('partial');
    expect(collection.omissions.some((omission) => omission.reason === 'parameter-reassigned')).toBe(true);
    expect(component.sourceCandidates?.find((candidate) => candidate.name === 'label')).toMatchObject({
      declaredRequired: true,
    });
  });

  it('uses compiler identity for a shadowed library name and distinguishes nullish/deferred lexical context', async () => {
    const { component, collection } = await observations(
      `type Props = { label: string | null }; export function Panel(props: Props) { const Math = { max: (a: number, b: number) => a + b }; const result = props.label ?? Math.max(1, 2); return <div>{result}</div>; }`,
    );
    const call = collection.observations.find((observation) => observation.kind === 'call');
    expect(call?.subject?.defaultLibrary).toBe(false);
    expect(call?.context.conditions[0]?.branch).toBe('nullish');
    expect(component.componentFacts?.nonStatic).toBeUndefined();
    const unresolved = await observations(
      `type Props = { label: string }; export function Panel(props: Props) { return <div>{unknownFunction(props.label)}</div>; }`,
      { componentObservationLimits: { maxSignatures: 0, maxObservations: 2, maxManifestReads: 0 } },
    );
    expect(unresolved.collection.coverage).toBe('partial');
    expect(unresolved.collection.used.maxObservations).toBeLessThanOrEqual(2);
    expect(unresolved.component.sourceCandidates?.[0]?.name).toBe('label');
  });

  it('is stable across repeated and reversed source order and does not classify renamed APIs', async () => {
    const { root, path } = fixture(source, { 'Other.tsx': 'export function Other() { return <div/>; }' });
    const first = await api.extractReactComponents([path, join(root, 'Other.tsx')], undefined, { projectRoot: root });
    const second = await api.extractReactComponents([join(root, 'Other.tsx'), path], undefined, { projectRoot: root });
    expect(first.components.map((component) => component.componentFacts)).toEqual(
      second.components.map((component) => component.componentFacts),
    );
    for (const name of ['useExample', 'routeExample', 'storeExample', 'plainExample']) {
      const result = await observations(
        `declare function ${name}(value: string): string; type Props = { label: string }; export function Panel(props: Props) { return <div>{${name}(props.label)}</div>; }`,
      );
      expect(result.collection.observations.filter((observation) => observation.kind === 'call')).toHaveLength(1);
      expect(result.component.componentFacts?.nonStatic).toBeUndefined();
    }
  });
});
