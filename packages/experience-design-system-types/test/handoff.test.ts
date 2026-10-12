import { describe, expect, it } from 'vitest';
import { HANDOFF_ENV, parseHandoff, serializeHandoff, type ImportHandoff } from '../src/handoff/index.js';

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

describe('ImportHandoff', () => {
  it('reads back exactly what was written', () => {
    expect(parseHandoff(serializeHandoff(handoff))).toEqual({ ok: true, handoff });
  });

  it('names the environment variable both sides use', () => {
    expect(HANDOFF_ENV).toBe('EDS_IMPORT_HANDOFF');
  });

  it('describes a handoff made before extraction moved to v2', () => {
    const early: ImportHandoff = { credentialsSkipped: true, tokens: { strategy: 'reuse' } };
    expect(parseHandoff(serializeHandoff(early))).toEqual({ ok: true, handoff: early });
  });

  it.each(['reuse', 'regenerate', 'generate'] as const)('accepts the %s token strategy', (strategy) => {
    expect(parseHandoff(serializeHandoff({ credentialsSkipped: false, tokens: { strategy } })).ok).toBe(true);
  });

  it('allows the entities path and token session to be null', () => {
    const nullable: ImportHandoff = {
      credentialsSkipped: true,
      tokens: { strategy: 'generate' },
      extraction: { ...extraction, tokenSessionId: null, existingEntitiesPath: null, existingEntitiesStatus: 'idle' },
    };
    expect(parseHandoff(serializeHandoff(nullable))).toEqual({ ok: true, handoff: nullable });
  });

  describe('the scope the user confirmed', () => {
    const scope = { accepted: ['Button', 'Card'], rejected: ['Helper'], cachedNames: ['Button'] };
    const confirmed: ImportHandoff = { ...handoff, scope };

    it('reads back exactly what was written', () => {
      expect(parseHandoff(serializeHandoff(confirmed))).toEqual({ ok: true, handoff: confirmed });
    });

    it('is absent before the gate has been confirmed', () => {
      const parsed = parseHandoff(serializeHandoff(handoff));
      expect(parsed.ok && parsed.handoff.scope).toBeUndefined();
    });

    it('allows nothing accepted, rejected or cached', () => {
      const empty: ImportHandoff = { ...handoff, scope: { accepted: [], rejected: [], cachedNames: [] } };
      expect(parseHandoff(serializeHandoff(empty))).toEqual({ ok: true, handoff: empty });
    });

    it.each(['accepted', 'rejected', 'cachedNames'] as const)('rejects a scope missing %s', (field) => {
      const { [field]: _removed, ...partial } = scope;
      const result = parseHandoff(JSON.stringify({ ...handoff, scope: partial }));
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toContain(`scope.${field}`);
    });

    it('rejects names that are not strings', () => {
      const result = parseHandoff(JSON.stringify({ ...handoff, scope: { ...scope, accepted: ['Button', 3] } }));
      expect(result.ok).toBe(false);
    });
  });

  describe('rejects a handoff that cannot be trusted, saying what is wrong', () => {
    const fails = (raw: string | undefined) => {
      const result = parseHandoff(raw);
      if (result.ok) throw new Error('expected a failure');
      return result.error;
    };

    it('when there is none', () => {
      expect(fails(undefined)).toMatch(/EDS_IMPORT_HANDOFF/);
      expect(fails('')).toMatch(/EDS_IMPORT_HANDOFF/);
    });

    it('when it is not JSON', () => {
      expect(fails('{nope')).toMatch(/not valid JSON/);
    });

    it('when it is not an object', () => {
      expect(fails('[]')).toMatch(/handoff/i);
    });

    it('when a required field is missing', () => {
      expect(fails(JSON.stringify({ tokens: { strategy: 'generate' } }))).toMatch(/credentialsSkipped/);
    });

    it('when the token strategy is unknown', () => {
      expect(fails(JSON.stringify({ credentialsSkipped: false, tokens: { strategy: 'maybe' } }))).toMatch(/strategy/);
    });

    it('when the composition phase is not one the scope gate can start from', () => {
      const bad = { ...handoff, extraction: { ...extraction, compositionPhase: 'resolving' } };
      expect(fails(JSON.stringify(bad))).toMatch(/compositionPhase/);
    });

    it('when the entities status says it is still running', () => {
      const bad = { ...handoff, extraction: { ...extraction, existingEntitiesStatus: 'running' } };
      expect(fails(JSON.stringify(bad))).toMatch(/existingEntitiesStatus/);
    });

    it('when the session id is empty', () => {
      const bad = { ...handoff, extraction: { ...extraction, sessionId: '' } };
      expect(fails(JSON.stringify(bad))).toMatch(/sessionId/);
    });
  });

  it('carries no credential: only paths, ids and statuses', () => {
    const keysOf = (value: unknown): string[] =>
      value && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)])
        : [];
    const keys = keysOf(JSON.parse(serializeHandoff(handoff)));
    expect(keys).not.toEqual(expect.arrayContaining(['cmaToken']));
    expect(keys.filter((key) => /token$/i.test(key) && key !== 'tokens')).toEqual([]);
  });
});
