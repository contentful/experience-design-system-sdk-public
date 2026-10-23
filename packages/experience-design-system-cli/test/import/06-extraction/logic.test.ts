import { describe, expect, it } from 'vitest';
import {
  agentAuthMessage,
  applyProgressEvent,
  initialProgress,
  isFullCacheHit,
  noComponentsMessage,
  progressRows,
  resolveAgentChoice,
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
    expect(initialProgress({ hasCredentials: true, hasRawTokens: true })).toEqual({
      scan: null,
      composition: 'resolving',
      selection: 'running',
      existingEntities: 'running',
      tokens: 'running',
    });
  });

  it('leaves out the entities fetch when credentials were skipped', () => {
    expect(initialProgress({ hasCredentials: false, hasRawTokens: true }).existingEntities).toBe('idle');
  });

  it('has no token job without a raw tokens file', () => {
    expect(initialProgress({ hasCredentials: true, hasRawTokens: false }).tokens).toBe('idle');
  });
});

describe('applyProgressEvent', () => {
  it('tracks the extract progress with done, total, and components-so-far', () => {
    const after = applyProgressEvent(base(), { kind: 'extract', done: 3, total: 40, componentsSoFar: 7 });
    expect(after.scan).toEqual({ scanned: 3, total: 40, componentsFound: 7 });
  });

  it('advances the scan as more extract events arrive', () => {
    const first = applyProgressEvent(base(), { kind: 'extract', done: 1, total: 40, componentsSoFar: 0 });
    const next = applyProgressEvent(first, { kind: 'extract', done: 40, total: 40, componentsSoFar: 12 });
    expect(next.scan).toEqual({ scanned: 40, total: 40, componentsFound: 12 });
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
    const rows = progressRows(initialProgress({ hasCredentials: true, hasRawTokens: true }), 'claude');
    expect(rows).toEqual([
      { id: 'source-analysis', text: 'Analyzing source files...', complete: false },
      {
        id: 'relationships',
        text: 'Source relationship evidence waiting for analysis…',
        complete: false,
        pending: true,
      },
      {
        id: 'exploration',
        text: 'Component exploration waiting for source evidence...',
        complete: false,
        pending: true,
      },
      { id: 'existing-entities', text: 'Fetching existing components and tokens...', complete: false, failed: false },
      {
        id: 'tokens',
        text: 'Generating token definitions via claude...',
        complete: false,
        failed: false,
        detail: 'Reading token source and preparing generation…',
      },
    ]);
  });

  it('counts analyzed files and marks the row done only once every file is processed', () => {
    expect(progressRows(base({ scan: { scanned: 1, total: 40 } }), 'claude')[0]).toEqual({
      id: 'source-analysis',
      text: 'Analyzing source files — 1/40',
      complete: false,
      progress: { done: 1, total: 40, label: 'source files considered' },
    });
    expect(progressRows(base({ scan: { scanned: 40, total: 40 } }), 'claude')[0]).toEqual({
      id: 'source-analysis',
      text: 'Analyzed 40 source files',
      complete: true,
      progress: { done: 40, total: 40, label: 'source files considered' },
    });
  });

  it('describes source evidence collection without claiming an agent is mapping composition', () => {
    expect(progressRows(base({ composition: 'agent:codex' }), 'claude')[1]?.text).toBe(
      'Collecting source relationship evidence…',
    );
  });

  it('says when composition came from the cache', () => {
    expect(progressRows(base({ composition: 'cache-hit' }), 'claude')[1]).toEqual({
      id: 'relationships',
      text: 'Component relationships (cached)',
      complete: true,
    });
    expect(progressRows(base({ composition: 'done' }), 'claude')[1]).toEqual({
      id: 'relationships',
      text: 'Component relationships collected',
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
    expect(progressRows(base({ existingEntities }), 'claude')[3]).toEqual({
      id: 'existing-entities',
      text,
      complete,
      failed: existingEntities === 'failed',
    });
  });

  it.each([
    ['running', 'Generating token definitions via claude...', false],
    ['complete', 'Token definitions ready', true],
    ['failed', 'Token definition generation failed', false],
  ] as const)('shows the token row when it is %s', (tokens, text, complete) => {
    expect(progressRows(base({ tokens }), 'claude')[3]).toEqual({
      id: 'tokens',
      text,
      complete,
      failed: tokens === 'failed',
      detail: tokens === 'running' ? 'Reading token source and preparing generation…' : undefined,
    });
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

describe('exploration progress rows', () => {
  it('distinguishes saved-evidence loading from agent work', () => {
    const row = progressRows(
      base({ exploration: { phase: 'components', stage: 'loading', done: 0, total: 7 } }),
      'codex',
    )[2];
    expect(row?.text).toBe('Reading and validating extracted component evidence...');
    expect(row?.progress).toBeUndefined();
  });
  it('shows the active explorer and counts only completed scopes', () => {
    const row = progressRows(
      base({ exploration: { phase: 'components', stage: 'exploring', scope: 'components-3', done: 2, total: 7 } }),
      'codex',
    )[2];
    expect(row).toMatchObject({
      text: 'Exploring components via codex — components-3',
      complete: false,
      progress: { done: 2, total: 7 },
    });
  });
  it('keeps finalization visible after every report has completed', () => {
    const row = progressRows(
      base({ exploration: { phase: 'components', stage: 'finalizing', done: 7, total: 7 } }),
      'codex',
    )[2];
    expect(row).toMatchObject({
      text: 'Saving component exploration results...',
      complete: false,
    });
    expect(row?.progress).toBeUndefined();
  });
});
