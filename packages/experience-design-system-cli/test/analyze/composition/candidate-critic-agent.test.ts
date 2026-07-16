import { describe, it, expect } from 'vitest';
import {
  buildDirCriticPrompt,
  parseDirCriticReply,
} from '../../../src/analyze/composition/candidate-critic-agent.js';

describe('buildDirCriticPrompt', () => {
  it('lists the offered directories and asks for a JSON array reply', () => {
    const p = buildDirCriticPrompt(['src/registry', 'src/utils']);
    expect(p).toContain('src/registry');
    expect(p).toContain('src/utils');
    expect(p).toMatch(/composition|parent|child|mapping/i);
    expect(p).toMatch(/json/i);
  });
});

describe('parseDirCriticReply', () => {
  const offered = ['src/registry', 'src/utils', 'src/mapping'];

  it('parses a JSON array of chosen dirs', () => {
    expect(parseDirCriticReply('["src/registry"]', offered)).toEqual(['src/registry']);
  });

  it('extracts the array from surrounding prose', () => {
    const reply = 'I think these look relevant:\n["src/registry", "src/mapping"]\nThe rest are utilities.';
    expect(parseDirCriticReply(reply, offered).sort()).toEqual(['src/mapping', 'src/registry']);
  });

  it('drops entries not in the offered set (no injection)', () => {
    expect(parseDirCriticReply('["src/registry", "src/evil"]', offered)).toEqual(['src/registry']);
  });

  it('returns empty for an empty array', () => {
    expect(parseDirCriticReply('[]', offered)).toEqual([]);
  });

  it('returns empty when no JSON array is present', () => {
    expect(parseDirCriticReply('none of these look relevant', offered)).toEqual([]);
  });

  it('returns empty on malformed JSON', () => {
    expect(parseDirCriticReply('[src/registry', offered)).toEqual([]);
  });
});
