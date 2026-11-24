import {
  captureNativeSource,
  decodeSourceDefault,
} from '../../../../../src/steps/extraction/src/candidates/native-source.js';
import { Node, Project } from 'ts-morph';
import { expect, it } from 'vitest';
import { observeTypeProps } from '../../../../../src/steps/extraction/src/candidates/source-candidates.js';
import {
  validateSourceGraph,
  validateSourceValue,
} from '../../../../../../experience-design-system-types/src/property-contract/property-model.js';

it('captures mapped recursive own fields and closed literal defaults without executing source', () => {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile(
    '/example.ts',
    `type Item = { '__proto__'?: boolean; 'a.b/λ': 0 | 1 }; type Props = { rows: Array<Partial<Item>>; deeper: { nested: { text: string } }; cyclic: Cycle; projected: Omit<Pick<{ keep: number; omit: string }, 'keep' | 'omit'>, 'omit'> & Partial<Item> }; type Cycle = { next?: Cycle };`,
  );
  const props = file.getTypeAliasOrThrow('Props').getType();
  const observations = observeTypeProps(
    props,
    [
      { name: 'rows', type: 'Array<Partial<Item>>', required: true },
      { name: 'deeper', type: '{ nested: { text: string } }', required: true },
      { name: 'cyclic', type: 'Cycle', required: true },
      { name: 'projected', type: 'Projected', required: true },
    ],
    '/example.ts',
    { sourceDefaults: new Map([['rows', `[{ ['__proto__']: false, 'a.b/λ': 0 }]`]]) },
  );
  const fact = observations[0]!.fact!;
  expect(fact).toHaveProperty('sourceGraph');
  expect(fact.sourceDefault).toMatchObject({ state: 'value', value: JSON.parse('[{"__proto__":false,"a.b/λ":0}]') });
  expect(fact.advisoryShape).toMatchObject({
    $type: 'array',
    $required: true,
    $items: {
      $type: 'record',
      $fields: {
        __proto__: { $type: 'boolean', $required: false },
        'a.b/λ': { $type: 'number', $required: false, $values: [0, 1] },
      },
    },
  });
  expect(Object.hasOwn(fact.advisoryShape!.$items!.$fields!, '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(fact.advisoryShape!.$items!.$fields!)).toBeNull();
  expect(observations[3]!.fact!.advisoryShape).toMatchObject({
    $type: 'record',
    $fields: { keep: { $type: 'number', $required: true }, 'a.b/λ': { $required: false } },
  });
  expect(Object.hasOwn(observations[3]!.fact!.advisoryShape!.$fields!, 'omit')).toBe(false);
  expect(JSON.stringify(observations[1]!.fact)).toContain('nested');
  expect(JSON.stringify(observations[2]!.fact)).toContain('cycle');
});

it('retains unsafe numeric source evidence without publishing rounded JSON values', () => {
  const project = new Project({ useInMemoryFileSystem: true });
  const file = project.createSourceFile('/unsafe.ts', 'type Props={count:9007199254740993}');
  const fact = observeTypeProps(
    file.getTypeAliasOrThrow('Props').getType(),
    [{ name: 'count', type: '9007199254740993', required: true }],
    '/unsafe.ts',
    { sourceDefaults: new Map([['count', '9007199254740993']]) },
  )[0]!.fact!;
  expect(fact.sourceDefault).toMatchObject({ expression: '9007199254740993', state: 'unsupported' });
  expect(fact.sourceTypeText).toBe('9007199254740993');
  expect(fact.sourceGraph?.coverage).toBe('partial');
  expect(fact.sourceGraph?.nodes[0]?.domain.declaredValues).toEqual([]);
});

it('distinguishes prototype setter syntax from literal computed own default keys', () => {
  const expression = "{'__proto__':false,'a.b/λ':0}";
  const actual = { __proto__: false, 'a.b/λ': 0 };
  expect(Object.hasOwn(actual, '__proto__')).toBe(false);
  expect(decodeSourceDefault(expression, null)).toMatchObject({ expression, state: 'unsupported' });
  const decoded = decodeSourceDefault("{['__proto__']:false,['a.b/λ']:0,[0]:''}", null);
  expect(decoded).toMatchObject({ state: 'value', value: JSON.parse('{"__proto__":false,"a.b/λ":0,"0":""}') });
  expect(decoded.value && typeof decoded.value === 'object' && Object.hasOwn(decoded.value, '__proto__')).toBe(true);
});

it('conserves tuple, union, index and recursive source coverage independently of native projection', () => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const file = project.createSourceFile(
    '/shapes.ts',
    `
    type Tuple = readonly [label: string, count?: number, ...rest: boolean[]];
    type Choice = { kind: 'first'; value: number } | { kind: 'second'; value: string | null };
    type Indexed = { [key: string]: number };
    type Cycle = { next?: Cycle };
  `,
  );
  for (const name of ['Tuple', 'Choice', 'Indexed', 'Cycle']) {
    const declaration = file.getTypeAliasOrThrow(name);
    const capture = captureNativeSource(declaration.getType(), declaration, true, ['a.b/λ']);
    expect(capture.graph.coverage).toBe('complete-within-declared-bound');
    expect(capture.graph.omittedCount).toBe(0);
    expect(capture.graph.nodes[0]?.keyPath).toEqual(['a.b/λ']);
  }
});

it('binds stable constant defaults to exact initializers and rejects mutated or opaque aliases', () => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const file = project.createSourceFile(
    '/defaults.ts',
    `
    const stable = { ['__proto__']: false, count: 0x10 } as const;
    const alias = stable;
    const changed = { count: 0 }; changed.count = 1;
    const escaped = { count: 0 }; unknownCall(escaped);
    type Props = { good: object; bad: object; opaque: object };
    function Example({ good: renamed = alias, bad = changed, opaque = escaped }: Props) {}
  `,
  );
  const func = file.getFunctionOrThrow('Example');
  const pattern = func.getParameters()[0]!.getNameNode();
  if (!Node.isObjectBindingPattern(pattern)) throw new Error('Expected binding pattern');
  const initializers = pattern.getElements();
  const good = initializers[0]!.getInitializerOrThrow();
  const fact = decodeSourceDefault(good.getText(), null, good);
  expect(fact).toMatchObject({ state: 'value', value: JSON.parse('{"__proto__":false,"count":16}') });
  expect(fact.dependencies?.length).toBeGreaterThan(0);
  for (const element of initializers.slice(1)) {
    const initializer = element.getInitializerOrThrow();
    expect(decodeSourceDefault(initializer.getText(), null, initializer).state).toBe('unsupported');
  }
});

it('retains non-JSON kinds, discriminator provenance and complete ordered tuple source semantics', () => {
  const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { strict: true } });
  const file = project.createSourceFile(
    '/evidence.ts',
    `
    type Big = bigint; type Symbolic = symbol; type Callback = (value:string) => void;
    type Tagged = {kind:'first';value:number} | {kind:'second';value:string};
    type OptionalTag = {kind?:'first';value:number} | {kind:'second';value:string};
    type DuplicateTag = {kind:'same';value:number} | {kind:'same';value:string};
    type Tuple = readonly [title:string,...counts:number[],enabled:boolean];
  `,
  );
  for (const name of ['Big', 'Symbolic', 'Callback']) {
    const declaration = file.getTypeAliasOrThrow(name);
    const captured = captureNativeSource(declaration.getType(), declaration, true, [name]);
    expect(captured.graph.coverage).toBe(name === 'Callback' ? 'partial' : 'complete-within-declared-bound');
    expect(captured.shape).toBeNull();
    expect(validateSourceGraph(captured.graph)).toEqual([]);
  }
  for (const name of ['Tagged', 'OptionalTag', 'DuplicateTag']) {
    const declaration = file.getTypeAliasOrThrow(name);
    const captured = captureNativeSource(declaration.getType(), declaration, true, [name]);
    expect(captured.graph.nodes[0]!.discriminator).toMatchObject({
      provenance: 'compiler',
      complete: true,
      keys: name === 'Tagged' ? ['kind'] : [],
    });
  }
  const declaration = file.getTypeAliasOrThrow('Tuple');
  const captured = captureNativeSource(declaration.getType(), declaration, true, ['a.b/λ']);
  expect(captured.graph.nodes[0]).toMatchObject({
    readonly: true,
    tupleElements: [
      { label: 'title', optional: false, rest: false },
      { label: 'counts', optional: false, rest: true },
      { label: 'enabled', optional: false, rest: false },
    ],
  });
  expect(validateSourceValue(captured.graph, ['title', 1, 2, false])).toEqual([]);
  expect(validateSourceValue(captured.graph, ['title', 1, 2, 'false']).length).toBeGreaterThan(0);
  const invalid = structuredClone(captured.graph);
  invalid.nodes[0]!.tupleElements![2]!.nodeId = 'missing';
  expect(validateSourceGraph(invalid).length).toBeGreaterThan(0);
});
