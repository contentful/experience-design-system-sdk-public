import { describe, expect, it } from 'vitest';
import { parseMapEdges } from '../../../src/analyze/composition/parse-map-edges.js';

const NAMES = new Set(['Page', 'Hero', 'Card', 'Button']);

describe('parseMapEdges', () => {
  it('parses a clean multi-line JSONL with 2 valid edges', () => {
    const raw = [
      '{"tool":"map_edge","parent":"Page","child":"Hero"}',
      '{"tool":"map_edge","parent":"Hero","child":"Button"}',
    ].join('\n');
    const { edges, warnings } = parseMapEdges(raw, { componentNames: NAMES });
    expect(edges).toHaveLength(2);
    expect(warnings).toHaveLength(0);
    expect(edges[0]).toEqual({ parent: 'Page', child: 'Hero', provenance: 'agent' });
    expect(edges[1]).toEqual({ parent: 'Hero', child: 'Button', provenance: 'agent' });
  });

  it('stamps provenance "agent" on every emitted edge', () => {
    const raw = [
      '{"tool":"map_edge","parent":"Page","child":"Hero"}',
      '{"tool":"map_edge","parent":"Card","child":"Button","slot":"actions","confidence":4}',
    ].join('\n');
    const { edges } = parseMapEdges(raw, { componentNames: NAMES });
    expect(edges.every((e) => e.provenance === 'agent')).toBe(true);
  });

  it('drops a malformed JSON line with a warning while good lines survive', () => {
    const raw = [
      '{"tool":"map_edge","parent":"Page","child":"Hero"}',
      '{"tool":"map_edge","parent":"Hero",',
      '{"tool":"map_edge","parent":"Card","child":"Button"}',
    ].join('\n');
    const { edges, warnings } = parseMapEdges(raw, { componentNames: NAMES });
    expect(edges).toHaveLength(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/unparseable line/);
  });

  it('drops an unknown tool value with a warning', () => {
    const raw = [
      '{"tool":"map_edge","parent":"Page","child":"Hero"}',
      '{"tool":"delete_edge","parent":"Page","child":"Card"}',
    ].join('\n');
    const { edges, warnings } = parseMapEdges(raw, { componentNames: NAMES });
    expect(edges).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/unknown tool: delete_edge/);
  });

  it('drops an edge naming an unknown parent, warning which side is unknown', () => {
    const raw = '{"tool":"map_edge","parent":"Sidebar","child":"Hero"}';
    const { edges, warnings } = parseMapEdges(raw, { componentNames: NAMES });
    expect(edges).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/unknown component/);
    expect(warnings[0]).toMatch(/parent/);
    expect(warnings[0]).toMatch(/Sidebar/);
  });

  it('drops an edge naming an unknown child, warning which side is unknown', () => {
    const raw = '{"tool":"map_edge","parent":"Page","child":"Widget"}';
    const { edges, warnings } = parseMapEdges(raw, { componentNames: NAMES });
    expect(edges).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/unknown component/);
    expect(warnings[0]).toMatch(/child/);
    expect(warnings[0]).toMatch(/Widget/);
  });

  it('drops a map_edge missing parent', () => {
    const raw = '{"tool":"map_edge","child":"Hero"}';
    const { edges, warnings } = parseMapEdges(raw, { componentNames: NAMES });
    expect(edges).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/missing parent\/child/);
  });

  it('drops a map_edge missing child', () => {
    const raw = '{"tool":"map_edge","parent":"Page"}';
    const { edges, warnings } = parseMapEdges(raw, { componentNames: NAMES });
    expect(edges).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/missing parent\/child/);
  });

  it('drops a map_edge with an empty-string parent', () => {
    const raw = '{"tool":"map_edge","parent":"","child":"Hero"}';
    const { edges, warnings } = parseMapEdges(raw, { componentNames: NAMES });
    expect(edges).toHaveLength(0);
    expect(warnings[0]).toMatch(/missing parent\/child/);
  });

  it('preserves an optional slot', () => {
    const raw = '{"tool":"map_edge","parent":"Card","child":"Button","slot":"actions"}';
    const { edges, warnings } = parseMapEdges(raw, { componentNames: NAMES });
    expect(warnings).toHaveLength(0);
    expect(edges[0]).toEqual({
      parent: 'Card',
      child: 'Button',
      slot: 'actions',
      provenance: 'agent',
    });
  });

  it('keeps a valid confidence within 1–5', () => {
    const raw = '{"tool":"map_edge","parent":"Page","child":"Hero","confidence":3}';
    const { edges, warnings } = parseMapEdges(raw, { componentNames: NAMES });
    expect(warnings).toHaveLength(0);
    expect(edges[0]).toEqual({ parent: 'Page', child: 'Hero', confidence: 3, provenance: 'agent' });
  });

  it('keeps the edge but drops an out-of-range confidence, with a warning', () => {
    const raw = '{"tool":"map_edge","parent":"Page","child":"Hero","confidence":9}';
    const { edges, warnings } = parseMapEdges(raw, { componentNames: NAMES });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ parent: 'Page', child: 'Hero', provenance: 'agent' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/confidence/);
  });

  it('ignores agent prose and blank lines silently', () => {
    const raw = [
      'Analyzing the component tree...',
      '',
      '{"tool":"map_edge","parent":"Page","child":"Hero"}',
      '   ',
      'Done. Emitted 1 edge.',
    ].join('\n');
    const { edges, warnings } = parseMapEdges(raw, { componentNames: NAMES });
    expect(edges).toHaveLength(1);
    expect(warnings).toHaveLength(0);
  });

  it('returns empty for input with no JSON lines', () => {
    const { edges, warnings } = parseMapEdges('just some prose\nand more', {
      componentNames: NAMES,
    });
    expect(edges).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});
