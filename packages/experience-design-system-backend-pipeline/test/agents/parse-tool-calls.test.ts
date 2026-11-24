import { describe, expect, it, vi } from 'vitest';
import { parseToolCalls } from '../../src/agents/parsers/parse-tool-calls.js';

describe('parseToolCalls', () => {
  it('accepts every classification tool through the shared contract', () => {
    const parsed = parseToolCalls(
      [
        'Thinking about the component first.',
        '{"tool":"classify_component","description":"Card","rationale":{"props":"Grounded"}}',
        '{"tool":"classify_prop","prop":"tone","cdf_type":"string","cdf_category":"design","values":["light","dark"],"default":"light"}',
        '{"tool":"exclude_prop","prop":"onClick","reason":"Callback"}',
        '{"tool":"classify_slot","slot":"children","required":false,"allowed_components":["Button"]}',
      ].join('\n'),
    );
    expect(parsed.warnings).toEqual([]);
    expect(parsed.calls).toEqual([
      { tool: 'classify_component', description: 'Card', rationale: { props: 'Grounded' } },
      {
        tool: 'classify_prop',
        prop: 'tone',
        cdf_type: 'string',
        cdf_category: 'design',
        values: ['light', 'dark'],
        default: 'light',
      },
      { tool: 'exclude_prop', prop: 'onClick', reason: 'Callback' },
      { tool: 'classify_slot', slot: 'children', required: false, allowed_components: ['Button'] },
    ]);
  });

  it('rejects malformed optional companions rather than accepting a truncated decision', () => {
    for (const companion of [{ required: 'yes' }, { description: 0 }, { reason: false }, { source_revision: 1 }]) {
      const parsed = parseToolCalls(
        JSON.stringify({
          tool: 'classify_prop',
          prop: 'a.b/λ',
          cdf_type: 'number',
          cdf_category: 'content',
          ...companion,
        }),
      );
      expect(parsed.calls).toEqual([]);
      expect(parsed.warnings.length).toBeGreaterThan(0);
    }
  });

  it('requires a reasoned exclusion and preserves semantic decisions with no representation', () => {
    expect(parseToolCalls('{"tool":"exclude_prop","prop":"callback","reason":" "}').calls).toEqual([]);
    expect(
      parseToolCalls(
        '{"tool":"classify_prop","prop":"data","cdf_category":"content","reason":"No available representation"}',
      ).calls,
    ).toEqual([
      { tool: 'classify_prop', prop: 'data', cdf_category: 'content', reason: 'No available representation' },
    ]);
  });

  it('names the failing field after the shared contract message', () => {
    const { warnings } = parseToolCalls(
      '{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content","token_kind":""}',
    );
    expect(warnings).toEqual([
      'decision 1: property:label: Token kind requires token representation [field: token_kind ($token.kind)]',
    ]);
  });

  it('names the unknown key when a decision carries a field the tool does not accept', () => {
    const { calls, warnings } = parseToolCalls(
      '{"tool":"classify_slot","slot":"children","allowedComponents":["Button"],"cdf_type":"string"}',
    );
    expect(calls).toEqual([]);
    expect(warnings).toEqual([
      'decision 1: slot:children: Unknown decision field: allowedComponents, cdf_type [field: allowedComponents, cdf_type]',
    ]);
  });

  it('names the failing field for every issue of a multi-issue rejection', () => {
    const { warnings } = parseToolCalls(
      JSON.stringify({
        tool: 'classify_prop',
        prop: 'tone',
        cdf_type: 'string',
        cdf_category: 'design',
        default_intent: { action: 'unknown' },
        values: 'light',
      }),
    );
    expect(warnings).toHaveLength(1);
    const issues = warnings[0]!.split('; ');
    expect(issues.slice(0, 2)).toEqual([
      'decision 1: property:tone: Invalid or conflicting default intent [field: default_intent]',
      'values must be an array [field: values ($values)]',
    ]);
  });

  it('leaves issues without a known field unannotated', () => {
    const { warnings } = parseToolCalls('{"tool":"classify_component","rationale":"Grounded"}');
    expect(warnings).toEqual(['decision 1: Invalid component rationale [field: rationale]']);
    expect(
      parseToolCalls(
        '{"tool":"classify_prop","prop":"a","cdf_type":"string","cdf_category":"content","source_revision":1}',
      ).warnings,
    ).toEqual(['decision 1: property:a: source_revision must be a string']);
  });

  it('rejects trailing JSON content instead of accepting the first decision', () => {
    const parsed = parseToolCalls('{"tool":"classify_component"} {"tool":"classify_component"}');
    expect(parsed.calls).toEqual([]);
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it('reports every rejected call to the invalid-call listener and keeps the valid ones', () => {
    const onInvalidCall = vi.fn();
    const parsed = parseToolCalls(
      [
        '{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content"}',
        '{"tool":"classify_prop","prop":"size","cdf_type":"impossible","cdf_category":"design"}',
        '{"tool":"unknown_tool"}',
      ].join('\n'),
      onInvalidCall,
    );
    expect(parsed.calls).toEqual([
      { tool: 'classify_prop', prop: 'label', cdf_type: 'string', cdf_category: 'content' },
    ]);
    expect(onInvalidCall.mock.calls.map(([message]) => message)).toEqual(parsed.warnings);
    expect(parsed.warnings).toEqual([
      'decision 2: property:size: Invalid representation type [field: cdf_type]',
      'decision 3: Unknown tool [field: tool]',
    ]);
  });
});
