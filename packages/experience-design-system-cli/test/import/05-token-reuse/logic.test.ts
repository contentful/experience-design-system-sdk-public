import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gateText, inspectTokens } from '../../../src/tui/import/steps/05-token-reuse/logic.js';

describe('inspectTokens', () => {
  let dir: string;
  let outDir: string;
  let rawTokensPath: string;
  let tokensPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'token-reuse-'));
    outDir = join(dir, 'project', '.contentful');
    rawTokensPath = join(dir, 'raw-tokens.json');
    tokensPath = join(outDir, 'tokens.json');
    await mkdir(outDir, { recursive: true });
    await writeFile(rawTokensPath, '{}');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function setTimes(file: string, secondsAgo: number): Promise<void> {
    const when = new Date(Date.now() - secondsAgo * 1000);
    await utimes(file, when, when);
  }

  it('has nothing to ask when no tokens.json was generated yet', async () => {
    expect(await inspectTokens({ rawTokensPath, outDir, cache: true })).toEqual({ kind: 'none' });
  });

  it('has nothing to ask when the cache is off, even if tokens.json exists', async () => {
    await writeFile(tokensPath, '{}');
    expect(await inspectTokens({ rawTokensPath, outDir, cache: false })).toEqual({ kind: 'none' });
  });

  it('offers the existing tokens.json when the source has not changed', async () => {
    await writeFile(tokensPath, '{}');
    await setTimes(rawTokensPath, 120);
    await setTimes(tokensPath, 60);
    expect(await inspectTokens({ rawTokensPath, outDir, cache: true })).toEqual({
      kind: 'cached',
      tokensPath,
      sourceChanged: false,
    });
  });

  it('flags the source as changed when it is newer than tokens.json', async () => {
    await writeFile(tokensPath, '{}');
    await setTimes(tokensPath, 120);
    await setTimes(rawTokensPath, 60);
    expect(await inspectTokens({ rawTokensPath, outDir, cache: true })).toEqual({
      kind: 'cached',
      tokensPath,
      sourceChanged: true,
    });
  });

  it('treats equal times as unchanged', async () => {
    await writeFile(tokensPath, '{}');
    const when = new Date(Date.now() - 60_000);
    await utimes(rawTokensPath, when, when);
    await utimes(tokensPath, when, when);
    expect(await inspectTokens({ rawTokensPath, outDir, cache: true })).toMatchObject({ sourceChanged: false });
  });

  it('does not flag a change when the source file cannot be read', async () => {
    await writeFile(tokensPath, '{}');
    expect(await inspectTokens({ rawTokensPath: join(dir, 'missing.json'), outDir, cache: true })).toMatchObject({
      kind: 'cached',
      sourceChanged: false,
    });
  });
});

describe('gateText', () => {
  it('says the source is unchanged and gives no extra context', () => {
    expect(gateText({ tokensPath: '/p/.contentful/tokens.json', sourceChanged: false })).toEqual({
      summary:
        'Source file has not changed since tokens were last generated.\n\nTokens Path: /p/.contentful/tokens.json',
    });
  });

  it('says the source changed and recommends regenerating', () => {
    expect(gateText({ tokensPath: '/p/.contentful/tokens.json', sourceChanged: true })).toEqual({
      summary:
        'Source file has been modified since tokens were last generated.\n\nTokens Path: /p/.contentful/tokens.json',
      context: 'The source tokens file changed — regenerating is recommended.',
    });
  });
});
