import { describe, expect, it } from 'vitest';
import { HANDOFF_ENV, parseHandoff } from '@contentful/experience-design-system-types/handoff';
import { buildEnv } from '../../../src/tui/import/spawn-v1-import.js';

// What app.tsx hands the wizard after the gate is confirmed. The legacy wizard reads it with the same parseHandoff, so
// this checks the environment the child really receives (not just the type) still carries the decisions intact.
describe('the handoff the wizard receives after the gate', () => {
  const handoff = {
    credentialsSkipped: false,
    tokens: { strategy: 'generate' as const },
    extraction: {
      sessionId: 'sess-1',
      outDir: '/p/.contentful',
      tokensPath: '/p/.contentful/tokens.json',
      tokenSessionId: null,
      tokenCount: 0,
      existingEntitiesPath: null,
      existingEntitiesStatus: 'idle' as const,
      compositionPhase: 'done' as const,
    },
    scope: { accepted: ['Button', 'Card'], rejected: ['Helper'], cachedNames: ['Button'] },
  };

  it('arrives in the environment and parses back to the same decisions', () => {
    const env = buildEnv({ handoff }, {});
    const parsed = parseHandoff(env[HANDOFF_ENV]);
    expect(parsed.ok && parsed.handoff.scope).toEqual(handoff.scope);
  });

  it('survives names with characters that are awkward in JSON or a shell', () => {
    const odd = {
      accepted: ['Weird "Name"', "It's", 'a b', 'ünï', '$HOME', 'x\\y'],
      rejected: [],
      cachedNames: ["It's"],
    };
    const env = buildEnv({ handoff: { ...handoff, scope: odd } }, {});
    const parsed = parseHandoff(env[HANDOFF_ENV]);
    expect(parsed.ok && parsed.handoff.scope).toEqual(odd);
  });

  it('carries a project with thousands of components without truncation', () => {
    const names = Array.from({ length: 5000 }, (_, i) => `Component${i}`);
    const env = buildEnv({ handoff: { ...handoff, scope: { accepted: names, rejected: [], cachedNames: names } } }, {});
    const parsed = parseHandoff(env[HANDOFF_ENV]);
    expect(parsed.ok && parsed.handoff.scope?.accepted).toHaveLength(5000);
  });
});
