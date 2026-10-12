import { describe, expect, it } from 'vitest';
import {
  buildExtractArgs,
  buildGenerateTokensArgs,
  buildPrintTokensArgs,
  lineSplitter,
} from '../../../src/tui/import/steps/06-extraction/processes.js';

const CLI = '/legacy/bin/cli.js';

describe('buildExtractArgs', () => {
  it('passes the project and the agent', () => {
    expect(buildExtractArgs(CLI, { projectPath: '/p', agent: 'claude', promptOverrides: [], noCache: false })).toEqual([
      CLI,
      '__extract',
      '--project',
      '/p',
      '--agent',
      'claude',
    ]);
  });

  it('refreshes composition and skips the cache together when the cache is off', () => {
    expect(buildExtractArgs(CLI, { projectPath: '/p', agent: 'claude', promptOverrides: [], noCache: true })).toEqual([
      CLI,
      '__extract',
      '--project',
      '/p',
      '--composition-refresh',
      '--no-cache',
      '--agent',
      'claude',
    ]);
  });

  it('repeats --prompt once per override, before the agent', () => {
    expect(
      buildExtractArgs(CLI, {
        projectPath: '/p',
        agent: 'codex',
        promptOverrides: ['select=./a.md', 'composition=literal text'],
        noCache: false,
      }),
    ).toEqual([
      CLI,
      '__extract',
      '--project',
      '/p',
      '--prompt',
      'select=./a.md',
      '--prompt',
      'composition=literal text',
      '--agent',
      'codex',
    ]);
  });

  it('leaves out --agent when there is none', () => {
    expect(buildExtractArgs(CLI, { projectPath: '/p', agent: '', promptOverrides: [], noCache: false })).toEqual([
      CLI,
      '__extract',
      '--project',
      '/p',
    ]);
  });

  it('never passes a model, since the extract command does not take one', () => {
    expect(
      buildExtractArgs(CLI, { projectPath: '/p', agent: 'claude', promptOverrides: [], noCache: false }),
    ).not.toContain('--model');
  });
});

describe('buildGenerateTokensArgs', () => {
  const base = {
    rawTokensPath: '/raw.json',
    outDir: '/p/.contentful',
    agent: 'claude',
    promptOverrides: [],
    noCache: false,
  };

  it('passes the agent and the raw tokens file', () => {
    expect(buildGenerateTokensArgs(CLI, base)).toEqual([
      CLI,
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
      buildGenerateTokensArgs(CLI, { ...base, agentModel: 'gpt-5', noCache: true, promptOverrides: ['token=./t.md'] }),
    ).toEqual([
      CLI,
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

describe('lineSplitter', () => {
  const collect = () => {
    const lines: string[] = [];
    return { lines, push: lineSplitter((line) => lines.push(line)) };
  };

  it('delivers each complete line', () => {
    const { lines, push } = collect();
    push('progress=scan:1\nprogress=scan:2\n');
    expect(lines).toEqual(['progress=scan:1', 'progress=scan:2']);
  });

  it('holds back a partial line until the next chunk finishes it', () => {
    const { lines, push } = collect();
    push('progress=sc');
    expect(lines).toEqual([]);
    push('an:5\nsession=ab');
    expect(lines).toEqual(['progress=scan:5']);
    push('c\n');
    expect(lines).toEqual(['progress=scan:5', 'session=abc']);
  });

  it('never delivers a trailing line that has no newline', () => {
    const { lines, push } = collect();
    push('complete\npartial');
    expect(lines).toEqual(['complete']);
  });

  it('delivers empty lines too', () => {
    const { lines, push } = collect();
    push('a\n\nb\n');
    expect(lines).toEqual(['a', '', 'b']);
  });
});
