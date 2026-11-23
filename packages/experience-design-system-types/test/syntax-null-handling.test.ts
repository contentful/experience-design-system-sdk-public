import { expect, it } from 'vitest';
import { validateNullHandlingSource } from '../src/property-contract/null-handling.js';
import type { PropertySourceGraph } from '../src/property-contract/property-model.js';

function graph(kind: 'number' | 'string' | 'boolean', nullable = true): PropertySourceGraph {
  return {
    schemaVersion: 1,
    rootId: 'value',
    coverage: 'complete-within-declared-bound',
    limits: { maxDepth: 16, maxNodes: 512, maxFields: 4096 },
    omittedCount: 0,
    nodes: [
      {
        id: 'value',
        keyPath: ['value'],
        kind,
        typeText: `${kind} | null`,
        required: false,
        nullable,
        nullability: {
          compilerMode: 'disabled',
          null: { state: nullable ? 'present' : 'unknown', source: nullable ? 'syntax' : 'compiler-erased' },
          undefined: { state: 'unknown', source: 'compiler-erased' },
        },
        domain: { openness: 'open', declaredValues: [], provenance: 'compiler' },
        coverage: 'complete-within-declared-bound',
        reason: null,
      },
    ],
  };
}

it.each(['number', 'string', 'boolean'] as const)(
  'admits a source-bound null judgment for a syntactically nullable %s without rewriting compiler nodes',
  (kind) => {
    const source = graph(kind);
    const before = structuredClone(source);
    expect(
      validateNullHandlingSource(
        [
          {
            sourceNodeId: 'value',
            handling: 'omit-equivalent',
            reason: 'The optional input has a captured null parameter default.',
          },
        ],
        source,
      ),
    ).toEqual([]);
    expect(source).toEqual(before);
  },
);

it('rejects unknown nullability and foreign source nodes', () => {
  const source = graph('number', false);
  expect(
    validateNullHandlingSource(
      [{ sourceNodeId: 'value', handling: 'omit-equivalent', reason: 'Unsupported guess.' }],
      source,
    ).length,
  ).toBeGreaterThan(0);
  expect(
    validateNullHandlingSource(
      [{ sourceNodeId: 'other', handling: 'omit-equivalent', reason: 'Foreign node.' }],
      graph('number'),
    ).length,
  ).toBeGreaterThan(0);
});
