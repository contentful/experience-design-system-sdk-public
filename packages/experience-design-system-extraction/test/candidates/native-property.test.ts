import { decodeSourceDefault } from '../../src/extract/candidates/native-source.js';
import { Project } from 'ts-morph';
import { expect, it } from 'vitest';
import { observeTypeProps } from '../../src/extract/candidates/source-candidates.js';

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
