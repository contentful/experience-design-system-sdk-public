import { describe, expect, it } from 'vitest';
import {
  describeGeneration,
  initialProgress,
  parseGenerateResult,
  progressRows,
  shouldRunMapTokens,
} from '../../../src/tui/import/steps/08-generation/logic.js';

describe('parseGenerateResult', () => {
  it('reads the session, the count and the renamed slots', () => {
    expect(
      parseGenerateResult({ stdout: 'session=gen-1\nrenamed-slots: 4\n', stderr: 'Generated 12 components\n' }, 99),
    ).toEqual({ generateSessionId: 'gen-1', generatedCount: 12, renamedSlotsCount: 4 });
  });

  it('reads a single component', () => {
    expect(
      parseGenerateResult({ stdout: 'session=gen-1\n', stderr: 'Generated 1 component\n' }, 99).generatedCount,
    ).toBe(1);
  });

  it('falls back to the accepted count when the command does not say how many', () => {
    expect(parseGenerateResult({ stdout: 'session=gen-1\n', stderr: '' }, 7).generatedCount).toBe(7);
  });

  it('has no session when the command printed none', () => {
    expect(parseGenerateResult({ stdout: '', stderr: '' }, 7).generateSessionId).toBeNull();
  });

  it('counts no renamed slots when it does not report them', () => {
    expect(parseGenerateResult({ stdout: 'session=gen-1\n', stderr: '' }, 1).renamedSlotsCount).toBe(0);
  });

  it('trims the session id', () => {
    expect(parseGenerateResult({ stdout: 'session=gen-1   \n', stderr: '' }, 1).generateSessionId).toBe('gen-1');
  });
});

describe('shouldRunMapTokens', () => {
  it('needs both something to map and tokens to map it from', () => {
    expect(shouldRunMapTokens({ mappablePropCount: 1, rawTokenCount: 1 })).toBe(true);
    expect(shouldRunMapTokens({ mappablePropCount: 0, rawTokenCount: 1 })).toBe(false);
    expect(shouldRunMapTokens({ mappablePropCount: 1, rawTokenCount: 0 })).toBe(false);
  });
});

describe('describeGeneration', () => {
  it('says what was accepted, then what is happening to it', () => {
    expect(describeGeneration({ acceptedCount: 5, agent: 'claude', hasTokens: false })).toBe(
      "5 components accepted.\nClaude is mapping your selected components to Contentful's Component Definition Format (CDF).",
    );
  });

  it('adds that the tokens are used when there are some', () => {
    expect(describeGeneration({ acceptedCount: 1, agent: 'codex', hasTokens: true })).toBe(
      "1 component accepted.\nCodex is mapping your selected components to Contentful's Component Definition Format (CDF). Using your design tokens for prop resolution.",
    );
  });
});

describe('progressRows', () => {
  it('starts with the agent starting up, before any progress line', () => {
    expect(progressRows(initialProgress(), 'claude')).toEqual([{ text: 'Starting up Claude...', complete: false }]);
  });

  it('shows the component being worked on with the count', () => {
    const rows = progressRows(
      { components: { done: 3, total: 12, current: 'Modal' }, mapTokens: 'idle', mapTokensEligible: null },
      'claude',
    );
    expect(rows).toEqual([{ text: 'Modal', complete: false, progress: { done: 3, total: 12 } }]);
  });

  it('adds the token mapping row only once mapping starts', () => {
    const base = { components: { done: 12, total: 12, current: 'Modal' }, mapTokensEligible: true };
    expect(progressRows({ ...base, mapTokens: 'idle' }, 'claude')).toHaveLength(1);
    expect(progressRows({ ...base, mapTokens: 'running' }, 'claude')[1]).toEqual({
      text: 'Mapping token restrictions via Claude...',
      complete: false,
    });
    expect(progressRows({ ...base, mapTokens: 'complete' }, 'claude')[1]).toEqual({
      text: 'Token restrictions ready',
      complete: true,
    });
  });
});
