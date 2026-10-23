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

  describe('what generation produced', () => {
    const review = {
      route: 'review',
      sessionId: 'gen-1',
      acceptedCount: 5,
      generatedCount: 4,
      mapTokensEligible: true,
    };
    const push = { route: 'push', acceptedCount: 0 };
    const withGeneration = (generation: unknown): string => JSON.stringify({ ...handoff, generation });

    it('reads back a generated session exactly as written', () => {
      const generated = { ...handoff, generation: review } as ImportHandoff;
      expect(parseHandoff(serializeHandoff(generated))).toEqual({ ok: true, handoff: generated });
    });

    it('reads back "nothing accepted" exactly as written', () => {
      const nothing = { ...handoff, generation: push } as ImportHandoff;
      expect(parseHandoff(serializeHandoff(nothing))).toEqual({ ok: true, handoff: nothing });
    });

    it('is absent before generation has run', () => {
      const parsed = parseHandoff(serializeHandoff(handoff));
      expect(parsed.ok && parsed.handoff.generation).toBeUndefined();
    });

    it('needs a route', () => {
      const { route: _removed, ...noRoute } = review;
      const result = parseHandoff(withGeneration(noRoute));
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toContain('generation.route');
    });

    it('rejects a route it does not know', () => {
      expect(parseHandoff(withGeneration({ ...review, route: 'done' })).ok).toBe(false);
    });

    it('has a session when it goes to review', () => {
      const result = parseHandoff(withGeneration({ ...review, sessionId: '' }));
      expect(result.ok).toBe(false);
      expect(!result.ok && result.error).toContain('generation.sessionId');
    });

    it.each(['sessionId', 'acceptedCount', 'generatedCount', 'mapTokensEligible'] as const)(
      'rejects a review missing %s',
      (field) => {
        const { [field]: _removed, ...partial } = review;
        const result = parseHandoff(withGeneration(partial));
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toContain(`generation.${field}`);
      },
    );

    it('rejects counts that are not numbers', () => {
      expect(parseHandoff(withGeneration({ ...review, acceptedCount: '5' })).ok).toBe(false);
    });

    it('only goes to push when nothing was accepted', () => {
      expect(parseHandoff(withGeneration({ route: 'push', acceptedCount: 3 })).ok).toBe(false);
    });

    it('does not accept a push that claims a generated session', () => {
      const result = parseHandoff(withGeneration({ ...push, sessionId: 'gen-1' }));
      expect(result.ok).toBe(true);
      expect(result.ok && 'sessionId' in (result.handoff.generation ?? {})).toBe(false);
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
