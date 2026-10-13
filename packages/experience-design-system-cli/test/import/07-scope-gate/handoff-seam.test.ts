import { describe, expect, it } from 'vitest';
import { HANDOFF_ENV, parseHandoff, type ImportHandoff } from '@contentful/experience-design-system-types/handoff';
import { buildEnv } from '../../../src/tui/import/spawn-v1-import.js';

// What app.tsx hands the wizard once the CLI has shown the gate and generated the definitions. The legacy wizard reads it
// with the same parseHandoff, so this checks that what the child really receives in its environment (not just the type)
// still carries the result intact.
describe('the handoff the wizard receives after generation', () => {
  const extraction = {
    sessionId: 'sess-1',
    outDir: '/p/.contentful',
    tokensPath: '/p/.contentful/tokens.json',
    tokenSessionId: null,
    tokenCount: 0,
    existingEntitiesPath: null,
    existingEntitiesStatus: 'idle' as const,
    compositionPhase: 'done' as const,
  };
  const handoff = (generation: ImportHandoff['generation']): ImportHandoff => ({
    credentialsSkipped: false,
    tokens: { strategy: 'generate' },
    extraction,
    generation,
  });

  const through = (given: ImportHandoff) => {
    const parsed = parseHandoff(buildEnv({ handoff: given }, {})[HANDOFF_ENV]);
    return parsed.ok ? parsed.handoff : undefined;
  };

  it('arrives in the environment and parses back to the same generated session', () => {
    const review = {
      route: 'review',
      sessionId: 'gen-1',
      acceptedCount: 5,
      generatedCount: 4,
      mapTokensEligible: true,
    } as const;
    expect(through(handoff(review))?.generation).toEqual(review);
  });

  it('arrives with the route to the push flow when nothing was accepted', () => {
    const push = { route: 'push', acceptedCount: 0 } as const;
    expect(through(handoff(push))?.generation).toEqual(push);
  });

  it('survives paths with characters that are awkward in JSON or a shell', () => {
    const odd = { ...extraction, outDir: '/p/My "Project" $HOME/it\'s/ünï\\x', tokensPath: '/p/a b/tokens.json' };
    const given: ImportHandoff = { ...handoff(undefined), extraction: odd };
    expect(through(given)?.extraction).toEqual(odd);
  });

  it('stays small however many components the project has, since it carries ids and counts and no names', () => {
    const review = {
      route: 'review',
      sessionId: 'gen-1',
      acceptedCount: 50000,
      generatedCount: 50000,
      mapTokensEligible: true,
    } as const;
    const size = buildEnv({ handoff: handoff(review) }, {})[HANDOFF_ENV]?.length ?? Infinity;
    // Linux caps one environment variable at 128 KB; this is a few hundred bytes
    expect(size).toBeLessThan(2000);
  });
});
