import { describe, expect, it } from 'vitest';
import { parseToolCallLines } from '../../src/generate/services/protocol-parser-service.js';

describe('component protocol parser', () => {
  it('parses component, prop, exclusion, and slot calls with optional fields', () => {
    const result = parseToolCallLines(
      [
        '{"tool":"classify_component","description":"Card","rationale":{"props":"visible"}}',
        '{"tool":"classify_prop","prop":"tone","cdf_type":"enum","cdf_category":"design","values":["light","dark"]}',
        '{"tool":"exclude_prop","prop":"className","reason":"framework detail"}',
        '{"tool":"classify_slot","slot":"body","required":true,"allowed_components":["Text"]}',
      ].join('\n'),
    );

    expect(result.calls).toHaveLength(4);
    expect(result.warnings).toEqual([]);
  });

  it('warns and skips invalid property calls', () => {
    const result = parseToolCallLines(
      '{"tool":"classify_prop","prop":"tone","cdf_type":"invalid","cdf_category":"design"}',
    );

    expect(result.calls).toEqual([]);
    expect(result.warnings).toEqual(["classify_prop 'tone': invalid cdf_type 'invalid' — skipped"]);
  });
});
