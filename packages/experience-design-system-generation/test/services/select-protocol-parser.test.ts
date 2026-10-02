import { describe, expect, it } from 'vitest';
import { parseSelectToolCallLines } from '../../src/generate/services/protocol-parser-service.js';

describe('select protocol parser', () => {
  it('parses accepted and rejected components with valid confidence', () => {
    const result = parseSelectToolCallLines(
      '{"tool":"select_component","name":"Card","reason":"renders UI","confidence":5}\n' +
        '{"tool":"reject_component","name":"useData","confidence":4}',
    );

    expect(result.calls).toEqual([
      { tool: 'select_component', name: 'Card', reason: 'renders UI', confidence: 5 },
      { tool: 'reject_component', name: 'useData', confidence: 4 },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('warns when a recognized selection call has no name', () => {
    const result = parseSelectToolCallLines('{"tool":"select_component"}');

    expect(result.calls).toEqual([]);
    expect(result.warnings).toEqual(['select_component missing name — skipped']);
  });
});
