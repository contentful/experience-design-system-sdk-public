import { describe, expect, it } from 'vitest';
import {
  buildGenerateArgs,
  buildMapTokensArgs,
  type GenerateCommand,
  type MapTokensCommand,
} from '../../../src/tui/import/steps/08-generation/processes.js';

const generate = (overrides: Partial<GenerateCommand> = {}): GenerateCommand => ({
  sessionId: 'sess-1',
  tokensPath: '/p/.contentful/tokens.json',
  agent: 'claude',
  promptOverrides: [],
  noCache: false,
  existingEntitiesPath: null,
  cachedComponents: [],
  ...overrides,
});

const mapTokens = (overrides: Partial<MapTokensCommand> = {}): MapTokensCommand => ({
  sessionId: 'gen-1',
  agent: 'claude',
  promptOverrides: [],
  noCache: false,
  existingEntitiesPath: null,
  ...overrides,
});

describe('buildGenerateArgs', () => {
  it('builds the plain command in the order the wizard did', () => {
    expect(buildGenerateArgs('/cli.js', generate())).toEqual([
      '/cli.js',
      '__generate',
      'components',
      '--agent',
      'claude',
      '--session',
      'sess-1',
      '--tokens',
      '/p/.contentful/tokens.json',
    ]);
  });

  it('adds every option in the wizard order, with the cached components last', () => {
    expect(
      buildGenerateArgs(
        '/cli.js',
        generate({
          agentModel: 'opus',
          noCache: true,
          generatePromptPath: '/p/gen.md',
          promptOverrides: ['components=/p/a.md', 'select=/p/b.md'],
          existingEntitiesPath: '/p/.existing.json',
          cachedComponents: ['Button', 'Card'],
        }),
      ),
    ).toEqual([
      '/cli.js',
      '__generate',
      'components',
      '--agent',
      'claude',
      '--session',
      'sess-1',
      '--tokens',
      '/p/.contentful/tokens.json',
      '--model',
      'opus',
      '--no-cache',
      '--generate-prompt-path',
      '/p/gen.md',
      '--prompt',
      'components=/p/a.md',
      '--prompt',
      'select=/p/b.md',
      '--existing-entities-path',
      '/p/.existing.json',
      '--cached-components',
      '["Button","Card"]',
    ]);
  });

  it('does not pass --restore-cache, since the cache was restored before this stage', () => {
    expect(buildGenerateArgs('/cli.js', generate({ cachedComponents: ['Button'] }))).not.toContain('--restore-cache');
  });

  it('leaves out --cached-components when the cache holds nothing', () => {
    expect(buildGenerateArgs('/cli.js', generate())).not.toContain('--cached-components');
  });

  it('leaves out --tokens when there is no tokens file', () => {
    expect(buildGenerateArgs('/cli.js', generate({ tokensPath: '' }))).not.toContain('--tokens');
  });

  it('leaves out --no-cache by default', () => {
    expect(buildGenerateArgs('/cli.js', generate())).not.toContain('--no-cache');
  });
});

describe('buildMapTokensArgs', () => {
  it('builds the plain command', () => {
    expect(buildMapTokensArgs(mapTokens())).toEqual(['map', 'tokens', '--session', 'gen-1', '--agent', 'claude']);
  });

  it('adds the options in the wizard order', () => {
    expect(
      buildMapTokensArgs(
        mapTokens({
          agentModel: 'model-a',
          noCache: true,
          promptOverrides: ['map-tokens=./map.md'],
          existingEntitiesPath: '/p/.existing.json',
        }),
      ),
    ).toEqual([
      'map',
      'tokens',
      '--session',
      'gen-1',
      '--agent',
      'claude',
      '--model',
      'model-a',
      '--no-cache',
      '--prompt',
      'map-tokens=./map.md',
      '--existing-entities-path',
      '/p/.existing.json',
    ]);
  });

  it('never passes --skip-agent, which the import command never asked for', () => {
    expect(buildMapTokensArgs(mapTokens())).not.toContain('--skip-agent');
  });
});
