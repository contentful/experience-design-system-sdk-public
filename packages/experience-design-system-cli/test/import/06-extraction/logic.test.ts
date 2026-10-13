import { describe, expect, it } from 'vitest';
import {
  agentAuthMessage,
  applyProgressEvent,
  initialProgress,
  isFullCacheHit,
  noComponentsMessage,
  progressRows,
  resolveAgentChoice,
  stepNumbers,
} from '../../../src/tui/import/steps/06-extraction/logic.js';
import type { ExtractionProgress } from '../../../src/tui/import/steps/06-extraction/types.js';

const base = (overrides: Partial<ExtractionProgress> = {}): ExtractionProgress => ({
  scan: null,
  composition: 'resolving',
  selection: 'running',
  existingEntities: 'idle',
  tokens: 'idle',
  ...overrides,
});

describe('initialProgress', () => {
  it('starts every job that applies, so no row appears later', () => {
    expect(initialProgress({ hasCredentials: true, hasRawTokens: true, reuseTokens: false })).toEqual({
      scan: null,
      composition: 'resolving',
      selection: 'running',
      existingEntities: 'running',
      tokens: 'running',
    });
  });

  it('leaves out the entities fetch when credentials were skipped', () => {
    expect(initialProgress({ hasCredentials: false, hasRawTokens: true, reuseTokens: false }).existingEntities).toBe(
      'idle',
    );
  });

  it('counts reused tokens as already done', () => {
    expect(initialProgress({ hasCredentials: true, hasRawTokens: true, reuseTokens: true }).tokens).toBe('complete');
  });

  it('has no token job without a raw tokens file', () => {
    expect(initialProgress({ hasCredentials: true, hasRawTokens: false, reuseTokens: false }).tokens).toBe('idle');
  });
});

describe('applyProgressEvent', () => {
  it('tracks the extract progress with done, total, and components-so-far', () => {
    const after = applyProgressEvent(base(), { kind: 'extract', done: 3, total: 40, componentsSoFar: 7 });
    expect(after.scan).toEqual({ scanned: 3, total: 40 });
  });

  it('advances the scan as more extract events arrive', () => {
    const first = applyProgressEvent(base(), { kind: 'extract', done: 1, total: 40, componentsSoFar: 0 });
    const next = applyProgressEvent(first, { kind: 'extract', done: 40, total: 40, componentsSoFar: 12 });
    expect(next.scan).toEqual({ scanned: 40, total: 40 });
  });

  it('records the composition phase and leaves the other rows alone', () => {
    const next = applyProgressEvent(base({ selection: 'complete' }), { kind: 'composition', phase: 'agent:claude' });
    expect(next.composition).toBe('agent:claude');
    expect(next.selection).toBe('complete');
  });

  it('does not change the progress it was given', () => {
    const before = base();
    applyProgressEvent(before, { kind: 'extract', done: 1, total: 10, componentsSoFar: 0 });
    expect(before.scan).toBeNull();
  });
});

describe('progressRows', () => {
  it('shows the first frame of a fresh run', () => {
    const rows = progressRows(
      initialProgress({ hasCredentials: true, hasRawTokens: true, reuseTokens: false }),
      'claude',
    );
    expect(rows).toEqual([
      { text: 'Scanning files...', complete: false },
      { text: 'Mapping composition via claude...', complete: false },
      { text: 'Filtering component selection via claude...', complete: false },
      { text: 'Fetching existing components and tokens...', complete: false },
      { text: 'Generating token definitions via claude...', complete: false },
    ]);
  });

  it('counts the files while scanning and marks the row done once the total is known', () => {
    expect(progressRows(base({ scan: { scanned: 1, total: null } }), 'claude')[0]).toEqual({
      text: 'Scanning 1 file',
      complete: false,
    });
    expect(progressRows(base({ scan: { scanned: 40, total: 40 } }), 'claude')[0]).toEqual({
      text: 'Scanned 40 files',
      complete: true,
    });
  });

  it('names the agent that is mapping composition', () => {
    expect(progressRows(base({ composition: 'agent:codex' }), 'claude')[1]?.text).toBe(
      'Mapping composition via codex...',
    );
  });

  it('says when composition came from the cache', () => {
    expect(progressRows(base({ composition: 'cache-hit' }), 'claude')[1]).toEqual({
      text: 'Composition mapping (cached)',
      complete: true,
    });
    expect(progressRows(base({ composition: 'done' }), 'claude')[1]).toEqual({
      text: 'Composition mapping complete',
      complete: true,
    });
  });

  it('leaves out the entities and token rows when they do not apply', () => {
    expect(progressRows(base(), 'claude')).toHaveLength(3);
  });

  it.each([
    ['running', 'Fetching existing components and tokens...', false],
    ['complete', 'Existing components and tokens ready', true],
    ['failed', 'Existing entities unavailable; continuing without them', true],
  ] as const)('shows the entities row when it is %s', (existingEntities, text, complete) => {
    expect(progressRows(base({ existingEntities }), 'claude')[3]).toEqual({ text, complete });
  });

  it.each([
    ['running', 'Generating token definitions via claude...', false],
    ['complete', 'Token definitions ready', true],
    ['failed', 'Token definition generation failed', false],
  ] as const)('shows the token row when it is %s', (tokens, text, complete) => {
    expect(progressRows(base({ tokens }), 'claude')[3]).toEqual({ text, complete });
  });
});

describe('isFullCacheHit', () => {
  const done = (overrides: Partial<ExtractionProgress> = {}) =>
    base({
      scan: { scanned: 40, total: 40 },
      composition: 'cache-hit',
      selection: 'complete',
      existingEntities: 'complete',
      tokens: 'complete',
      ...overrides,
    });

  it('is true when every job is already done', () => {
    expect(isFullCacheHit(done())).toBe(true);
  });

  it('is true without credentials or tokens, which have nothing to wait for', () => {
    expect(isFullCacheHit(done({ existingEntities: 'idle', tokens: 'idle' }))).toBe(true);
  });

  it('is true when the entities fetch failed, since it is no longer running', () => {
    expect(isFullCacheHit(done({ existingEntities: 'failed' }))).toBe(true);
  });

  it.each([
    ['the scan has no total yet', { scan: { scanned: 3, total: null } }],
    ['there are no files', { scan: { scanned: 0, total: 0 } }],
    ['composition is still running', { composition: 'resolving' as const }],
    ['selection is still running', { selection: 'running' as const }],
    ['the entities fetch is still running', { existingEntities: 'running' as const }],
    ['tokens are still generating', { tokens: 'running' as const }],
    ['token generation failed', { tokens: 'failed' as const }],
  ])('is false while %s', (_name, overrides) => {
    expect(isFullCacheHit(done(overrides))).toBe(false);
  });
});

describe('stepNumbers', () => {
  it('is step 2 of 6 with a token stage', () => {
    expect(stepNumbers({ hasRawTokens: true })).toEqual({ stepNumber: 2, totalSteps: 6 });
  });

  it('is step 1 of 5 without one', () => {
    expect(stepNumbers({ hasRawTokens: false })).toEqual({ stepNumber: 1, totalSteps: 5 });
  });

  it('drops the component steps when components are skipped', () => {
    expect(stepNumbers({ hasRawTokens: true, skipComponents: true }).totalSteps).toBe(4);
  });

  it('adds the map tokens step only once it is known to run', () => {
    expect(stepNumbers({ hasRawTokens: true, mapTokensEligible: true }).totalSteps).toBe(7);
    expect(stepNumbers({ hasRawTokens: true, mapTokensEligible: false }).totalSteps).toBe(6);
    expect(stepNumbers({ hasRawTokens: true, mapTokensEligible: null }).totalSteps).toBe(6);
  });
});

describe('error messages', () => {
  it('names the path when no components were found', () => {
    expect(noComponentsMessage('/p')).toBe(
      'No components found in /p.\n\nMake sure this path contains TypeScript/React/Vue component files (.tsx, .ts, .vue, etc.).',
    );
  });

  it('tells the user to install a missing agent', () => {
    expect(agentAuthMessage('claude', 'not-found')).toBe(
      'The `claude` CLI was not found on your PATH.\n\nInstall it, then re-run `experiences import`.',
    );
  });

  it('tells the user to log in to an unauthenticated agent, and mentions Bedrock', () => {
    const message = agentAuthMessage('codex', 'unauthenticated');
    expect(message).toContain('codex is not authenticated.');
    expect(message).toContain('Run `codex` in your terminal to log in');
    expect(message).toContain('aws sso login --profile <your-profile>');
  });
});

describe('resolveAgentChoice', () => {
  it('defaults to Claude with no model', () => {
    expect(resolveAgentChoice(undefined, {})).toEqual({ agent: 'claude' });
  });

  it('uses what experiences setup saved', () => {
    expect(resolveAgentChoice(undefined, { agent: 'codex', agentModel: 'gpt-5' })).toEqual({
      agent: 'codex',
      agentModel: 'gpt-5',
    });
  });

  it('lets --agent win over the saved agent', () => {
    expect(resolveAgentChoice('cursor', { agent: 'codex' })).toEqual({ agent: 'cursor' });
  });

  it('reads agent:model and agent model from the flag', () => {
    expect(resolveAgentChoice('codex:gpt-5', {})).toEqual({ agent: 'codex', agentModel: 'gpt-5' });
    expect(resolveAgentChoice('codex gpt-5', {})).toEqual({ agent: 'codex', agentModel: 'gpt-5' });
  });

  it('lets the flag model win over the saved model, and keeps the saved model when the flag has none', () => {
    expect(resolveAgentChoice('codex:flag-model', { agentModel: 'saved' })).toEqual({
      agent: 'codex',
      agentModel: 'flag-model',
    });
    expect(resolveAgentChoice('codex', { agentModel: 'saved' })).toEqual({ agent: 'codex', agentModel: 'saved' });
  });

  it('ignores saved values that are not strings', () => {
    expect(resolveAgentChoice(undefined, { agent: 7, agentModel: null })).toEqual({ agent: 'claude' });
  });
});
