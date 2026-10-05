import { describe, expect, it } from 'vitest';
import { parseMapTokenPropToolCallLines } from '../../src/generate/services/protocol-parser-service.js';

describe('map-token protocol parser', () => {
  it('parses non-empty token restrictions', () => {
    const result = parseMapTokenPropToolCallLines(
      '{"tool":"map_token_prop","component":"Card","prop":"color","token_allowed":["colors.brand.primary"]}',
    );

    expect(result.calls).toEqual([
      {
        tool: 'map_token_prop',
        component: 'Card',
        prop: 'color',
        token_allowed: ['colors.brand.primary'],
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('rejects empty or non-string token restrictions', () => {
    const result = parseMapTokenPropToolCallLines(
      '{"tool":"map_token_prop","component":"Card","prop":"color","token_allowed":[]}',
    );

    expect(result.calls).toEqual([]);
    expect(result.warnings).toEqual(["map_token_prop 'Card.color': missing or empty token_allowed — skipped"]);
  });
});

describe('parseMapTokenPropToolCallLines', () => {
  it('parses a call with token_allowed, ignoring an extra description field', () => {
    const line =
      '{"tool":"map_token_prop","component":"Card","prop":"padding","token_allowed":["spacing.xs"],"description":"restricted"}';
    const { calls, warnings } = parseMapTokenPropToolCallLines(line);
    expect(warnings).toHaveLength(0);
    expect(calls[0]).toEqual({
      tool: 'map_token_prop',
      component: 'Card',
      prop: 'padding',
      token_allowed: ['spacing.xs'],
    });
  });

  it('parses a call with multiple token_allowed entries', () => {
    const line =
      '{"tool":"map_token_prop","component":"Button","prop":"variantColor","token_allowed":["colors.brand.primary","colors.brand.secondary"]}';
    const { calls, warnings } = parseMapTokenPropToolCallLines(line);
    expect(warnings).toHaveLength(0);
    expect(calls[0]).toEqual({
      tool: 'map_token_prop',
      component: 'Button',
      prop: 'variantColor',
      token_allowed: ['colors.brand.primary', 'colors.brand.secondary'],
    });
  });

  it('warns and skips on missing component', () => {
    const { calls, warnings } = parseMapTokenPropToolCallLines(
      '{"tool":"map_token_prop","prop":"bgColor","token_allowed":["colors.surface"]}',
    );
    expect(calls).toHaveLength(0);
    expect(warnings[0]).toMatch(/missing component/);
  });

  it('warns and skips on missing prop', () => {
    const { calls, warnings } = parseMapTokenPropToolCallLines(
      '{"tool":"map_token_prop","component":"Card","token_allowed":["colors.surface"]}',
    );
    expect(calls).toHaveLength(0);
    expect(warnings[0]).toMatch(/missing prop/);
  });

  it('warns and skips on missing token_allowed', () => {
    const { calls, warnings } = parseMapTokenPropToolCallLines(
      '{"tool":"map_token_prop","component":"Card","prop":"bgColor"}',
    );
    expect(calls).toHaveLength(0);
    expect(warnings[0]).toMatch(/missing or empty token_allowed/);
  });

  it('warns and skips on empty token_allowed array', () => {
    const { calls, warnings } = parseMapTokenPropToolCallLines(
      '{"tool":"map_token_prop","component":"Card","prop":"bgColor","token_allowed":[]}',
    );
    expect(calls).toHaveLength(0);
    expect(warnings[0]).toMatch(/missing or empty token_allowed/);
  });

  it('warns and skips when token_allowed is not a string array', () => {
    const line = '{"tool":"map_token_prop","component":"Button","prop":"variantColor","token_allowed":"colors.brand"}';
    const { calls, warnings } = parseMapTokenPropToolCallLines(line);
    expect(calls).toHaveLength(0);
    expect(warnings[0]).toMatch(/missing or empty token_allowed/);
  });

  it('warns on unparseable JSON', () => {
    const { calls, warnings } = parseMapTokenPropToolCallLines('{bad json}');
    expect(calls).toHaveLength(0);
    expect(warnings[0]).toMatch(/unparseable line/);
  });

  it('silently skips non-map-tokens tool names (e.g. set_token)', () => {
    const { calls, warnings } = parseMapTokenPropToolCallLines(
      '{"tool":"set_token","path":"colors.a","type":"color","value":"#fff"}',
    );
    expect(calls).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('ignores prose lines and continues after a bad line', () => {
    const stdout = [
      'Looking at Card.bgColor',
      '{"tool":"map_token_prop","component":"Card","prop":"bgColor","token_allowed":["colors.surface"]}',
      '{not valid json}',
      '{"tool":"map_token_prop","component":"Button","prop":"variantColor","token_allowed":["colors.brand.primary"]}',
    ].join('\n');
    const { calls, warnings } = parseMapTokenPropToolCallLines(stdout);
    expect(calls).toHaveLength(2);
    expect(warnings).toHaveLength(1);
  });
});
