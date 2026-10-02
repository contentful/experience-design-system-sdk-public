import { describe, expect, it } from 'vitest';
import { parseToolCallLines } from '../../src/generate/services/protocol-parser-service.js';

describe('protocol parser framing', () => {
  it('skips prose and preserves trailing-content warnings around balanced JSON', () => {
    const lines = [
      'reasoning before the call',
      '{"tool":"classify_component"} trailing text',
      'reasoning after the call',
    ];
    const result = parseToolCallLines(lines.join('\n'));

    expect(result.calls).toEqual([{ tool: 'classify_component' }]);
    expect(result.warnings).toEqual(['ignored trailing content after JSON: trailing text']);
  });

  it('continues after malformed JSON and reports the bounded source line', () => {
    const result = parseToolCallLines('{"tool":"classify_component"\n{"tool":"classify_component"}');

    expect(result.calls).toEqual([{ tool: 'classify_component' }]);
    expect(result.warnings[0]).toMatch(/^unparseable line:/);
  });
});
