import { describe, expect, it } from 'vitest';
import { parseMapEdges } from '../../helpers/parse-map-edges.js';

const names = new Set(['Button', 'Card', 'Layout', 'Hero']);

describe('parseMapEdges', () => {
  it('returns empty for empty input', () => {
    expect(parseMapEdges('', { componentNames: names })).toEqual({ edges: [], warnings: [] });
  });

  it('parses a valid map_edge with slot and confidence', () => {
    const raw = JSON.stringify({ tool: 'map_edge', parent: 'Layout', child: 'Button', slot: 'content', confidence: 4 });
    const { edges, warnings } = parseMapEdges(raw, { componentNames: names });
    expect(warnings).toHaveLength(0);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ parent: 'Layout', child: 'Button', slot: 'content', confidence: 4, provenance: 'agent' });
  });

  it('parses a map_edge without optional slot or confidence', () => {
    const raw = JSON.stringify({ tool: 'map_edge', parent: 'Card', child: 'Button' });
    const { edges } = parseMapEdges(raw, { componentNames: names });
    expect(edges[0]).toMatchObject({ parent: 'Card', child: 'Button', provenance: 'agent' });
    expect(edges[0]!.slot).toBeUndefined();
    expect(edges[0]!.confidence).toBeUndefined();
  });

  it('warns and skips unknown tool', () => {
    const raw = JSON.stringify({ tool: 'bad_tool', parent: 'Layout', child: 'Button' });
    const { edges, warnings } = parseMapEdges(raw, { componentNames: names });
    expect(edges).toHaveLength(0);
    expect(warnings[0]).toContain('unknown tool');
  });

  it('warns and skips when parent is not in componentNames', () => {
    const raw = JSON.stringify({ tool: 'map_edge', parent: 'Ghost', child: 'Button' });
    const { edges, warnings } = parseMapEdges(raw, { componentNames: names });
    expect(edges).toHaveLength(0);
    expect(warnings[0]).toContain('unknown component (parent): Ghost');
  });

  it('warns and skips when child is not in componentNames', () => {
    const raw = JSON.stringify({ tool: 'map_edge', parent: 'Layout', child: 'Ghost' });
    const { edges, warnings } = parseMapEdges(raw, { componentNames: names });
    expect(edges).toHaveLength(0);
    expect(warnings[0]).toContain('unknown component (child): Ghost');
  });

  it('warns and skips when parent or child is missing', () => {
    const raw = JSON.stringify({ tool: 'map_edge', parent: 'Layout' });
    const { edges, warnings } = parseMapEdges(raw, { componentNames: names });
    expect(edges).toHaveLength(0);
    expect(warnings[0]).toContain('missing parent/child');
  });

  it('keeps edge but drops confidence when confidence is out of 1-5 range', () => {
    const raw = JSON.stringify({ tool: 'map_edge', parent: 'Layout', child: 'Button', confidence: 10 });
    const { edges, warnings } = parseMapEdges(raw, { componentNames: names });
    expect(edges).toHaveLength(1);
    expect(edges[0]!.confidence).toBeUndefined();
    expect(warnings[0]).toContain('invalid confidence');
  });

  it('skips non-JSON lines silently', () => {
    const raw = 'just text\nmore text';
    const { edges, warnings } = parseMapEdges(raw, { componentNames: names });
    expect(edges).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('warns on unparseable JSON', () => {
    const raw = '{broken json';
    const { edges, warnings } = parseMapEdges(raw, { componentNames: names });
    expect(edges).toHaveLength(0);
    expect(warnings[0]).toContain('unparseable line');
  });

  it('parses multiple valid lines', () => {
    const lines = [
      JSON.stringify({ tool: 'map_edge', parent: 'Layout', child: 'Button' }),
      JSON.stringify({ tool: 'map_edge', parent: 'Card', child: 'Hero' }),
    ].join('\n');
    const { edges } = parseMapEdges(lines, { componentNames: names });
    expect(edges).toHaveLength(2);
  });
});
