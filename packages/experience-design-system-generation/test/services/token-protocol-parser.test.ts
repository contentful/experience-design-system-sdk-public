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
