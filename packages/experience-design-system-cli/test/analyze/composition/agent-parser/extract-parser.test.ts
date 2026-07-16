import { describe, it, expect } from 'vitest';
import { extractParserSource } from '../../../../src/analyze/composition/agent-parser/extract-parser.js';

const FN = 'export default function (ctx) {\n  return [];\n}';

describe('extractParserSource', () => {
  it('extracts a fenced ```js code block', () => {
    const out = extractParserSource('Here is the parser:\n```js\n' + FN + '\n```\nDone.');
    expect(out).toBe(FN);
  });

  it('extracts a fenced ```javascript block', () => {
    const out = extractParserSource('```javascript\n' + FN + '\n```');
    expect(out).toBe(FN);
  });

  it('extracts a fenced block with no language tag', () => {
    const out = extractParserSource('```\n' + FN + '\n```');
    expect(out).toBe(FN);
  });

  it('extracts bare source when it has export default and no fences', () => {
    const out = extractParserSource('prose before\n' + FN + '\nprose after');
    expect(out).toContain('export default function');
    expect(out).toContain('return []');
  });

  it('prefers the first fenced block when multiple exist', () => {
    const second = 'export default function (ctx) {\n  return [1];\n}';
    const out = extractParserSource('```js\n' + FN + '\n```\n```js\n' + second + '\n```');
    expect(out).toBe(FN);
  });

  it('returns null when there is no code and no export default', () => {
    expect(extractParserSource('I could not find any composition convention.')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(extractParserSource('')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    const out = extractParserSource('```js\n\n   ' + FN + '   \n\n```');
    expect(out).toBe(FN);
  });
});
