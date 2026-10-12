import { describe, expect, it } from 'vitest';
import { HANDOFF_ENV, parseHandoff } from '@contentful/experience-design-system-types/handoff';
import { buildArgs, buildEnv } from '../src/tui/import/spawn-v1-import.js';

describe('buildArgs', () => {
  it('starts the legacy import with only the paths the TUI collected', () => {
    expect(buildArgs({ projectPath: './src', tokens: './theme.css' })).toEqual([
      'import',
      '--project',
      './src',
      '--tokens',
      './theme.css',
    ]);
  });

  it('is unchanged when none of the new flags were given', () => {
    expect(buildArgs({ projectPath: './src', tokens: './theme.css', prompt: [], cache: true })).toEqual(
      buildArgs({ projectPath: './src', tokens: './theme.css' }),
    );
  });

  it('forwards --agent, every --prompt and --no-cache to the legacy wizard', () => {
    expect(
      buildArgs({
        projectPath: './src',
        tokens: './theme.css',
        agent: 'codex:gpt-5',
        prompt: ['select=./p.md', 'token=literal'],
        cache: false,
      }),
    ).toEqual([
      'import',
      '--project',
      './src',
      '--tokens',
      './theme.css',
      '--agent',
      'codex:gpt-5',
      '--prompt',
      'select=./p.md',
      '--prompt',
      'token=literal',
      '--no-cache',
    ]);
  });
});

describe('buildEnv', () => {
  const handoff = {
    credentialsSkipped: false,
    tokens: { strategy: 'generate' as const },
    extraction: {
      sessionId: 'sess-1',
      outDir: '/p/.contentful',
      tokensPath: '/p/.contentful/tokens.json',
      tokenSessionId: 'tok-1',
      tokenCount: 12,
      existingEntitiesPath: '/p/.contentful/.existing-entities.json',
      existingEntitiesStatus: 'complete' as const,
      compositionPhase: 'done' as const,
    },
  };

  it('adds nothing for a launch with no handoff', () => {
    expect(buildEnv({}, { PATH: '/bin' })).toEqual({ PATH: '/bin' });
  });

  it('passes everything the CLI settled to legacy in one variable that reads back unchanged', () => {
    const env = buildEnv({ handoff }, { HOME: '/h' });
    expect(env.HOME).toBe('/h');
    expect(parseHandoff(env[HANDOFF_ENV])).toEqual({ ok: true, handoff });
  });

  it('no longer sets the separate skip-credentials and token variables', () => {
    const env = buildEnv({ handoff: { ...handoff, credentialsSkipped: true } }, {});
    expect(Object.keys(env)).toEqual([HANDOFF_ENV]);
  });
});
