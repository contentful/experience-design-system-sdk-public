import { describe, expect, it } from 'vitest';
import { credentialsPurpose } from '../../../src/tui/import/steps/04-credentials/logic.js';
import { producedOf, writtenThings } from '../../../src/tui/import/steps/10-flow/support/produced.js';

describe('what an import produced', () => {
  it('has components and tokens for an import that generated both', () => {
    expect(producedOf({ extractSessionId: 'ext', tokensPath: '/t.json', tokenSessionId: 'tok' })).toEqual({
      components: true,
      tokens: true,
    });
  });

  it('has only tokens when there was no extraction, so the Done screen offers no components link', () => {
    expect(producedOf({ extractSessionId: null, tokensPath: '/t.json', tokenSessionId: 'tok' })).toEqual({
      components: false,
      tokens: true,
    });
  });

  it('has only components when no tokens were generated, so the Done screen offers no tokens link', () => {
    expect(producedOf({ extractSessionId: 'ext', tokensPath: '', tokenSessionId: null })).toEqual({
      components: true,
      tokens: false,
    });
  });
});

describe('the wording that depends on it', () => {
  it('keeps the original wording when both were produced', () => {
    expect(writtenThings({ components: true, tokens: true })).toBe('component types and design tokens');
    expect(credentialsPurpose(false)).toBe('We use it to check what components already exist and to push your import.');
  });

  it('names only what was produced otherwise', () => {
    expect(writtenThings({ components: false, tokens: true })).toBe('design tokens');
    expect(writtenThings({ components: true, tokens: false })).toBe('component types');
    expect(credentialsPurpose(true)).not.toContain('components');
  });
});
