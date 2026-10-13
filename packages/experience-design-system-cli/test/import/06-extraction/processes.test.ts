import { describe, expect, it } from 'vitest';
import {
  buildGenerateTokensArgs,
  buildPrintTokensArgs,
} from '../../../src/tui/import/steps/06-extraction/processes.js';

describe('buildGenerateTokensArgs', () => {
  const base = {
    rawTokensPath: '/raw.json',
    outDir: '/p/.contentful',
    agent: 'claude',
    promptOverrides: [],
    noCache: false,
  };

  it('passes the agent and the raw tokens file', () => {
    expect(buildGenerateTokensArgs(base)).toEqual([
      '__generate',
      'tokens',
      '--agent',
      'claude',
      '--raw-tokens',
      '/raw.json',
    ]);
  });

  it('adds the model, the cache flag and each prompt in the wizard order', () => {
    expect(
      buildGenerateTokensArgs({ ...base, agentModel: 'gpt-5', noCache: true, promptOverrides: ['token=./t.md'] }),
    ).toEqual([
      '__generate',
      'tokens',
      '--agent',
      'claude',
      '--raw-tokens',
      '/raw.json',
      '--model',
      'gpt-5',
      '--no-cache',
      '--prompt',
      'token=./t.md',
    ]);
  });
});

describe('buildPrintTokensArgs', () => {
  it('writes to the given path', () => {
    expect(buildPrintTokensArgs('/p/.contentful/tokens.json', null)).toEqual([
      'print',
      'tokens',
      '--out',
      '/p/.contentful/tokens.json',
    ]);
  });

  it('prints from the token session when there is one', () => {
    expect(buildPrintTokensArgs('/t.json', 'tok-1')).toEqual([
      'print',
      'tokens',
      '--out',
      '/t.json',
      '--session',
      'tok-1',
    ]);
  });
});
