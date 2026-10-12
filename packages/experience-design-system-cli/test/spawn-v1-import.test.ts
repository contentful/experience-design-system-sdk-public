import { describe, expect, it } from 'vitest';
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
  it('adds nothing for a plain launch', () => {
    expect(buildEnv({}, { PATH: '/bin' })).toEqual({ PATH: '/bin' });
  });

  it('marks skipped credentials', () => {
    expect(buildEnv({ skipCredentials: true }, {})).toEqual({ EDS_IMPORT_SKIP_CREDENTIALS: '1' });
  });

  it.each(['reuse', 'regenerate', 'generate'] as const)('passes the %s token strategy to legacy', (tokenStrategy) => {
    expect(buildEnv({ tokenStrategy }, {})).toEqual({ EDS_IMPORT_TOKENS: tokenStrategy });
  });

  it('keeps the rest of the environment', () => {
    expect(buildEnv({ skipCredentials: true, tokenStrategy: 'reuse' }, { HOME: '/h' })).toEqual({
      HOME: '/h',
      EDS_IMPORT_SKIP_CREDENTIALS: '1',
      EDS_IMPORT_TOKENS: 'reuse',
    });
  });
});
