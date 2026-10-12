import { describe, expect, it } from 'vitest';
import { HANDOFF_ENV, serializeHandoff, type ImportHandoff } from '@contentful/experience-design-system-types/handoff';
import { readHandoff, scopeFromHandoff, stateFromHandoff } from '../../../src/import/tui/handoff.js';

const extraction = {
  sessionId: 'sess-1',
  outDir: '/p/.contentful',
  tokensPath: '/p/.contentful/tokens.json',
  tokenSessionId: 'tok-1',
  tokenCount: 12,
  existingEntitiesPath: '/p/.contentful/.existing-entities.json',
  existingEntitiesStatus: 'complete',
  compositionPhase: 'done',
} as const;

const handoff: ImportHandoff = { credentialsSkipped: false, tokens: { strategy: 'generate' }, extraction };

describe('stateFromHandoff', () => {
  it('seeds every field the early stages used to write', () => {
    expect(stateFromHandoff(handoff)).toEqual({
      credentialsSkipped: false,
      tokensPath: '/p/.contentful/tokens.json',
      tokenSessionId: 'tok-1',
      tokenCount: 12,
      tokenGenerationStatus: 'complete',
      outDir: '/p/.contentful',
      extractSessionId: 'sess-1',
      compositionPhase: 'done',
      selectionAgentStatus: 'complete',
      existingEntitiesStatus: 'complete',
      existingEntitiesPath: '/p/.contentful/.existing-entities.json',
    });
  });

  it('keeps credentials skipped, and an entities fetch that never ran, as the wizard left them', () => {
    const state = stateFromHandoff({
      credentialsSkipped: true,
      tokens: { strategy: 'generate' },
      extraction: { ...extraction, existingEntitiesStatus: 'idle', existingEntitiesPath: null },
    });
    expect(state.credentialsSkipped).toBe(true);
    expect(state.existingEntitiesStatus).toBe('idle');
    expect(state.existingEntitiesPath).toBeNull();
  });

  it('carries a composition cache hit', () => {
    expect(
      stateFromHandoff({ ...handoff, extraction: { ...extraction, compositionPhase: 'cache-hit' } }).compositionPhase,
    ).toBe('cache-hit');
  });

  it('seeds only the credentials answer before extraction has moved to the CLI', () => {
    expect(stateFromHandoff({ credentialsSkipped: true, tokens: { strategy: 'reuse' } })).toEqual({
      credentialsSkipped: true,
    });
  });

  it('never marks extraction as still in progress', () => {
    const state = stateFromHandoff(handoff);
    expect(state.selectionAgentStatus).toBe('complete');
    expect(state.tokenGenerationStatus).toBe('complete');
    expect(['done', 'cache-hit']).toContain(state.compositionPhase);
    expect(['idle', 'complete', 'failed']).toContain(state.existingEntitiesStatus);
  });
});

describe('readHandoff', () => {
  it('reads the handoff the CLI passed', () => {
    const result = readHandoff({ [HANDOFF_ENV]: serializeHandoff(handoff) });
    expect(result).toMatchObject({ ok: true, handoff });
  });

  it('refuses to start without one, and says why', () => {
    const result = readHandoff({});
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/must be started by the CLI/);
  });

  it('refuses a handoff it cannot trust', () => {
    const result = readHandoff({ [HANDOFF_ENV]: '{"credentialsSkipped":"yes"}' });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/invalid/);
  });
});

describe('scopeFromHandoff', () => {
  const scope = { accepted: ['Button', 'Card'], rejected: ['Helper'], cachedNames: ['Button'] };

  it('is the decisions and the components the cache already holds', () => {
    expect(scopeFromHandoff({ ...handoff, scope })).toEqual({
      decisions: { accepted: ['Button', 'Card'], rejected: ['Helper'] },
      cachedNames: ['Button'],
    });
  });

  it('is nothing before the gate has been confirmed', () => {
    expect(scopeFromHandoff(handoff)).toBeNull();
  });

  it('comes with the handoff the wizard reads', () => {
    const read = readHandoff({ [HANDOFF_ENV]: serializeHandoff({ ...handoff, scope }) });
    expect(read.ok && read.scope?.decisions.accepted).toEqual(['Button', 'Card']);
  });

  it('is nothing when the wizard was started without one', () => {
    const read = readHandoff({ [HANDOFF_ENV]: serializeHandoff(handoff) });
    expect(read.ok && read.scope).toBeNull();
  });
});
