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
