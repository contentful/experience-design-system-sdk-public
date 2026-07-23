import { describe, it, expect } from 'vitest';
import {
  extractParserSource,
  looksLikeParser,
} from '../../../../src/analyze/composition/agent-parser/extract-parser.js';

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

  it('prefers the first PARSER-SHAPED fenced block, skipping non-parser blocks', () => {
    // The agent often shows a JSON example or an unrelated snippet first.
    const jsonSample = '```json\n{ "parent": "A", "child": "B" }\n```';
    const out = extractParserSource(jsonSample + '\nNow the parser:\n```js\n' + FN + '\n```');
    expect(out).toBe(FN);
  });

  it('returns null when a fenced block exists but is not parser-shaped', () => {
    const out = extractParserSource('```json\n{ "not": "a parser" }\n```');
    expect(out).toBeNull();
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

  it('rejects bare source that has export default but no ctx parameter', () => {
    expect(extractParserSource('export default function () { return []; }')).toBeNull();
  });
});

describe('looksLikeParser', () => {
  it('accepts a default-exported function taking a ctx param', () => {
    expect(looksLikeParser('export default function (ctx) { return []; }')).toBe(true);
  });

  it('accepts an arrow form', () => {
    expect(looksLikeParser('export default (ctx) => { return []; }')).toBe(true);
  });

  it('accepts a differently-named single param', () => {
    expect(looksLikeParser('export default function (input) { return []; }')).toBe(true);
  });

  it('rejects source without export default', () => {
    expect(looksLikeParser('function (ctx) { return []; }')).toBe(false);
  });

  it('rejects a default export that is not a function', () => {
    expect(looksLikeParser('export default { parent: "A" };')).toBe(false);
    expect(looksLikeParser('export default 42;')).toBe(false);
  });

  it('rejects a function with no parameter', () => {
    expect(looksLikeParser('export default function () { return []; }')).toBe(false);
  });
});
