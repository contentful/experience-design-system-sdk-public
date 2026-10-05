import { describe, expect, it } from 'vitest';
import { parseTokenToolCallLines } from '../../src/generate/services/protocol-parser-service.js';

describe('token protocol parser', () => {
  it('preserves token values across primitive, array, and group calls', () => {
    const result = parseTokenToolCallLines(
      [
        '{"tool":"set_group","path":"colors"}',
        '{"tool":"set_token","path":"colors.primary","type":"color","value":{"colorSpace":"srgb","components":[1,0,0]}}',
        '{"tool":"set_token","path":"space.sm","type":"dimension","value":"0.5rem"}',
      ].join('\n'),
    );

    expect(result.calls).toHaveLength(3);
    expect(result.calls[1]).toMatchObject({ path: 'colors.primary', type: 'color' });
    expect(result.warnings).toEqual([]);
  });

  it('requires path, type, and value for token calls', () => {
    const result = parseTokenToolCallLines('{"tool":"set_token","path":"colors.primary","type":"color"}');

    expect(result.calls).toEqual([]);
    expect(result.warnings).toEqual(["set_token 'colors.primary': missing value — skipped"]);
  });
});

describe('parseTokenToolCallLines', () => {
  it('parses set_group with description', () => {
    const { calls } = parseTokenToolCallLines(
      '{"tool":"set_group","path":"colors.brand","description":"Brand palette"}',
    );
    expect(calls[0]).toEqual({ tool: 'set_group', path: 'colors.brand', description: 'Brand palette' });
  });

  it('parses set_group without description', () => {
    const { calls } = parseTokenToolCallLines('{"tool":"set_group","path":"spacing"}');
    expect(calls[0]).toMatchObject({ tool: 'set_group', path: 'spacing' });
    expect((calls[0] as { description?: string }).description).toBeUndefined();
  });

  it('parses set_token with string value', () => {
    const line =
      '{"tool":"set_token","path":"colors.brand.primary","type":"color","value":"#0066ff","description":"Brand primary"}';
    const { calls } = parseTokenToolCallLines(line);
    expect(calls[0]).toMatchObject({
      tool: 'set_token',
      path: 'colors.brand.primary',
      type: 'color',
      value: '#0066ff',
    });
  });

  it('parses set_token with numeric value', () => {
    const line = '{"tool":"set_token","path":"spacing.sm","type":"dimension","value":"8px"}';
    const { calls } = parseTokenToolCallLines(line);
    expect(calls[0]).toMatchObject({ tool: 'set_token', path: 'spacing.sm', type: 'dimension', value: '8px' });
  });

  it('parses set_token with object value (shadow)', () => {
    const shadow = { offsetX: '0px', offsetY: '4px', blur: '8px', spread: '0px', color: '#00000026' };
    const line = JSON.stringify({ tool: 'set_token', path: 'effects.shadow', type: 'shadow', value: shadow });
    const { calls } = parseTokenToolCallLines(line);
    expect(calls[0]).toMatchObject({ tool: 'set_token', type: 'shadow', value: shadow });
  });

  it('parses set_token with array value (gradient)', () => {
    const gradient = [
      { color: '#000', position: 0 },
      { color: '#fff', position: 1 },
    ];
    const line = JSON.stringify({ tool: 'set_token', path: 'effects.gradient', type: 'gradient', value: gradient });
    const { calls } = parseTokenToolCallLines(line);
    expect(calls[0]).toMatchObject({ tool: 'set_token', type: 'gradient', value: gradient });
  });

  it('warns on set_token missing path', () => {
    const { calls, warnings } = parseTokenToolCallLines('{"tool":"set_token","type":"color","value":"#fff"}');
    expect(calls).toHaveLength(0);
    expect(warnings[0]).toMatch(/missing path/);
  });

  it('warns on set_token missing type', () => {
    const { calls, warnings } = parseTokenToolCallLines('{"tool":"set_token","path":"colors.a","value":"#fff"}');
    expect(calls).toHaveLength(0);
    expect(warnings[0]).toMatch(/missing type/);
  });

  it('warns on set_token missing value', () => {
    const { calls, warnings } = parseTokenToolCallLines('{"tool":"set_token","path":"colors.a","type":"color"}');
    expect(calls).toHaveLength(0);
    expect(warnings[0]).toMatch(/missing value/);
  });

  it('warns on set_group missing path', () => {
    const { calls, warnings } = parseTokenToolCallLines('{"tool":"set_group","description":"no path"}');
    expect(calls).toHaveLength(0);
    expect(warnings[0]).toMatch(/missing path/);
  });

  it('warns on unparseable JSON', () => {
    const { calls, warnings } = parseTokenToolCallLines('{bad json}');
    expect(calls).toHaveLength(0);
    expect(warnings[0]).toMatch(/unparseable line/);
  });

  it('silently skips non-token tool names (e.g. classify_prop)', () => {
    const { calls, warnings } = parseTokenToolCallLines(
      '{"tool":"classify_prop","prop":"label","cdf_type":"string","cdf_category":"content"}',
    );
    expect(calls).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('ignores prose lines', () => {
    const stdout = [
      'Organizing tokens into groups',
      '{"tool":"set_group","path":"colors"}',
      'now emitting the primary color',
      '{"tool":"set_token","path":"colors.primary","type":"color","value":"#0066ff","description":"primary"}',
    ].join('\n');
    const { calls, warnings } = parseTokenToolCallLines(stdout);
    expect(warnings).toHaveLength(0);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ tool: 'set_group', path: 'colors' });
    expect(calls[1]).toMatchObject({ tool: 'set_token', path: 'colors.primary', type: 'color' });
  });

  it('continues after a bad line', () => {
    const stdout = [
      '{"tool":"set_group","path":"colors"}',
      '{not valid json}',
      '{"tool":"set_token","path":"colors.a","type":"color","value":"#fff","description":"x"}',
    ].join('\n');
    const { calls, warnings } = parseTokenToolCallLines(stdout);
    expect(calls).toHaveLength(2);
    expect(warnings).toHaveLength(1);
  });
});
