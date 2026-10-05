import { describe, expect, it } from 'vitest';
import { extractSentinelOutput } from '../../src/generate/services/protocol-parser-service.js';

describe('extractSentinelOutput', () => {
  const START = '<<<EDS_OUTPUT_START>>>';
  const END = '<<<EDS_OUTPUT_END>>>';

  it('extracts content between sentinels', () => {
    const stdout = `some preamble\n${START}\n{"a":1}\n${END}\ntrailing`;
    expect(extractSentinelOutput(stdout)).toBe('{"a":1}');
  });

  it('returns null when start sentinel is missing', () => {
    expect(extractSentinelOutput(`{"a":1}\n${END}`)).toBeNull();
  });

  it('returns null when end sentinel is missing', () => {
    expect(extractSentinelOutput(`${START}\n{"a":1}`)).toBeNull();
  });

  it('returns null when both sentinels are missing', () => {
    expect(extractSentinelOutput('no sentinels here')).toBeNull();
  });

  it('returns "multiple" when two complete sentinel blocks are present', () => {
    const block = `${START}\n{"a":1}\n${END}`;
    expect(extractSentinelOutput(`${block}\n${block}`)).toBe('multiple');
  });

  it('trims whitespace from extracted content', () => {
    const stdout = `${START}\n\n  {"a":1}  \n\n${END}`;
    expect(extractSentinelOutput(stdout)).toBe('{"a":1}');
  });
});
