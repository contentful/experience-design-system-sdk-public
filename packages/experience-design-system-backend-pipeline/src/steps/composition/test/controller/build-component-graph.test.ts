import { describe, expect, it } from 'vitest';
import { buildComponentGraph } from '../../src/controller/build-component-graph.js';

describe('buildComponentGraph', () => {
  it('maps CDF entries to graph nodes with slot allowedComponents', () => {
    const graph = buildComponentGraph({
      components: [
        {
          key: 'Card',
          entry: {
            $type: 'component',
            $properties: {},
            $slots: { body: { $allowedComponents: ['Text', 'Image'] } },
          },
        },
      ],
    });
    expect(graph).toEqual([{ name: 'Card', slots: [{ name: 'body', allowedComponents: ['Text', 'Image'] }] }]);
  });

  it('strips slot edges from rejected components when stripRejectedEdges is set', () => {
    const graph = buildComponentGraph({
      components: [
        {
          key: 'Card',
          status: 'rejected',
          entry: {
            $type: 'component',
            $properties: {},
            $slots: { body: { $allowedComponents: ['Text'] } },
          },
        },
      ],
      stripRejectedEdges: true,
    });
    expect(graph).toEqual([{ name: 'Card', slots: [] }]);
  });

  it('filters non-string allowedComponents entries', () => {
    const graph = buildComponentGraph({
      components: [
        {
          key: 'Card',
          entry: {
            $type: 'component',
            $properties: {},
            $slots: { body: { $allowedComponents: ['Text', 42 as never, null as never, 'Image'] } },
          },
        },
      ],
    });
    expect(graph[0].slots[0].allowedComponents).toEqual(['Text', 'Image']);
  });
});
