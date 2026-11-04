import { describe, expect, it } from 'vitest';
import * as api from '../../../../../src/steps/extraction/index.js';

describe('generic closure core barrel', () => {
  it('exports the actual graph, SCC, summary and proof algebra seam', () => {
    for (const name of [
      'buildClosureGraph',
      'orderClosureSccs',
      'computeClosureSummaries',
      'deriveClosureFact',
      'closureValueEqual',
    ]) {
      expect(api).toHaveProperty(name, expect.any(Function));
    }
  });
  it('reads each successful and missing identity once, preserves ends and sorts a diamond', () => {
    expect(api).toHaveProperty('buildClosureGraph', expect.any(Function));
    const reads: string[] = [];
    const nodes = new Map([
      [
        'root',
        {
          id: 'root',
          data: null,
          edges: [
            { target: 'b', kind: 'call' },
            { target: 'a', kind: 'call' },
            { target: 'a', kind: 'call' },
          ],
          ends: [{ kind: 'dead' as const, reason: 'terminal' }],
        },
      ],
      [
        'a',
        {
          id: 'a',
          data: null,
          edges: [
            { target: 'leaf', kind: 'call' },
            { target: 'missing', kind: 'call' },
          ],
          ends: [],
        },
      ],
      [
        'b',
        {
          id: 'b',
          data: null,
          edges: [
            { target: 'leaf', kind: 'call' },
            { target: 'missing', kind: 'call' },
          ],
          ends: [],
        },
      ],
      ['leaf', { id: 'leaf', data: null, edges: [], ends: [] }],
    ]);
    const graph = api.buildClosureGraph(['root', 'root', 'absent'], (id) => {
      reads.push(id);
      return nodes.get(id);
    });
    expect(new Set(reads).size).toBe(reads.length);
    expect([...graph.nodes.keys()]).toEqual(['a', 'b', 'leaf', 'root']);
    expect(graph.missingRoots).toEqual(['absent']);
    expect(graph.nodes.get('a')!.ends).toContainEqual({ kind: 'open', reason: 'unresolved-target', target: 'missing' });
    expect(graph.nodes.get('root')!.ends).toContainEqual({ kind: 'dead', reason: 'terminal' });
    expect(api.orderClosureSccs(graph).map((scc) => scc.members)).toEqual([['leaf'], ['a'], ['b'], ['root']]);
    expect(() =>
      api.buildClosureGraph(['root'], () => {
        throw new Error('read-failed');
      }),
    ).toThrow('read-failed');
  });
  it('orders deep chains iteratively and identifies self and mutual cycles', () => {
    expect(api).toHaveProperty('buildClosureGraph', expect.any(Function));
    const graph = api.buildClosureGraph(['0'], (id) => ({
      id,
      data: null,
      ends: [],
      edges: Number(id) < 12000 ? [{ target: String(Number(id) + 1), kind: 'next' }] : [],
    }));
    const order = api.orderClosureSccs(graph);
    expect(order).toHaveLength(12001);
    expect(order[0]!.members).toEqual(['12000']);
    expect(order.at(-1)!.members).toEqual(['0']);
    const cycles = api.buildClosureGraph(['a', 'self'], (id) => ({
      id,
      data: null,
      ends: [],
      edges: [{ target: id === 'a' ? 'b' : id === 'b' ? 'a' : 'self', kind: 'next' }],
    }));
    expect(api.orderClosureSccs(cycles)).toEqual([
      { members: ['a', 'b'], cyclic: true },
      { members: ['self'], cyclic: true },
    ]);
    expect(api.orderClosureSccs(api.buildClosureGraph([], () => undefined))).toEqual([]);
  });
  it('combines only used facts with weakest proof and independent open dependence', () => {
    expect(api).toHaveProperty('deriveClosureFact', expect.any(Function));
    const exact = api.deriveClosureFact('local', [], { provenance: ['local'] });
    const open = api.deriveClosureFact('external', [], {
      strength: 'unknown',
      dependsOnOpenEnd: true,
      provenance: ['remote'],
    });
    expect(api.deriveClosureFact('result', [exact])).toEqual({
      value: 'result',
      strength: 'exact',
      dependsOnOpenEnd: false,
      provenance: ['local'],
    });
    expect(api.deriveClosureFact('result', [exact, open])).toEqual({
      value: 'result',
      strength: 'unknown',
      dependsOnOpenEnd: true,
      provenance: ['local', 'remote'],
    });
  });
  it('memoizes acyclic transfers, converges cycles and exposes finite nonconvergence', () => {
    expect(api).toHaveProperty('computeClosureSummaries', expect.any(Function));
    const calls = new Map<string, number>();
    const graph = api.buildClosureGraph(['root'], (id) => ({
      id,
      data: null,
      ends: [],
      edges: id === 'root' ? [{ target: 'leaf', kind: 'next' }] : [],
    }));
    const summaries = api.computeClosureSummaries(graph, {
      bottom: () => ({}),
      transfer: (node, get) => {
        calls.set(node.id, (calls.get(node.id) ?? 0) + 1);
        return { count: api.deriveClosureFact(node.id === 'leaf' ? 1 : Number(get('leaf')!.count!.value) + 1) };
      },
    });
    expect(summaries.get('root')!.count!.value).toBe(2);
    expect([...calls.values()]).toEqual([1, 1]);
    const cyclic = api.buildClosureGraph(['cycle'], (id) => ({
      id,
      data: null,
      ends: [],
      edges: [{ target: id, kind: 'next' }],
    }));
    let count = 0;
    const stable = api.computeClosureSummaries(cyclic, {
      bottom: () => ({ value: api.deriveClosureFact(0) }),
      transfer: () => {
        count += 1;
        return { value: api.deriveClosureFact(0, [], { strength: 'inferred', dependsOnOpenEnd: true }) };
      },
    });
    expect(count).toBe(2);
    expect(stable.get('cycle')!.value!.strength).toBe('inferred');
    expect(() =>
      api.computeClosureSummaries(
        cyclic,
        {
          bottom: () => ({ value: api.deriveClosureFact(0) }),
          transfer: (node, get) => ({ value: api.deriveClosureFact(Number(get(node.id)!.value!.value) + 1) }),
        },
        { maxIterations: 3 },
      ),
    ).toThrow('Closure cycle did not converge');
    for (const maxIterations of [0, -1, NaN, Infinity])
      expect(() =>
        api.computeClosureSummaries(cyclic, { bottom: () => ({}), transfer: () => ({}) }, { maxIterations }),
      ).toThrow('positive safe integer');
  });
  it('compares supported immutable values and rejects unsupported cyclic or class values', () => {
    expect(api).toHaveProperty('closureValueEqual', expect.any(Function));
    expect(
      api.closureValueEqual(
        {
          list: [null, 1, true],
          map: new Map([
            ['b', 2],
            ['a', 1],
          ]),
          set: new Set(['b', 'a']),
        },
        {
          set: new Set(['a', 'b']),
          map: new Map([
            ['a', 1],
            ['b', 2],
          ]),
          list: [null, 1, true],
        },
      ),
    ).toBe(true);
    expect(api.closureValueEqual([1], [2])).toBe(false);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => api.closureValueEqual(cyclic, cyclic)).toThrow('acyclic');
    expect(() => api.closureValueEqual(new Date(), new Date())).toThrow('Unsupported');
  });
});

it('is deterministic under shuffled roots/edges and observes proof, open dependence and provenance changes separately', () => {
  const read = (id: string) => ({
    id,
    data: null,
    edges:
      id === 'root'
        ? [
            { target: 'b', kind: 'call' },
            { target: 'a', kind: 'call' },
          ]
        : [],
    ends: [],
  });
  const first = api.buildClosureGraph(['root', 'a'], read);
  const second = api.buildClosureGraph(['a', 'root'], (id) => ({ ...read(id), edges: [...read(id).edges].reverse() }));
  expect(first).toEqual(second);
  expect(api.orderClosureSccs(first)).toEqual(api.orderClosureSccs(second));
  const graph = api.buildClosureGraph(['self'], (id) => ({
    id,
    data: null,
    edges: [{ target: id, kind: 'call' }],
    ends: [],
  }));
  for (const changed of [
    { strength: 'inferred' as const },
    { dependsOnOpenEnd: true },
    { provenance: ['dependency'] },
  ]) {
    let transfers = 0;
    api.computeClosureSummaries(graph, {
      bottom: () => ({ fact: api.deriveClosureFact(1) }),
      transfer: () => {
        transfers += 1;
        return { fact: api.deriveClosureFact(1, [], changed) };
      },
    });
    expect(transfers).toBe(2);
  }
});
