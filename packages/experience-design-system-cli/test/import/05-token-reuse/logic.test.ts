import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectTokens } from '../../../src/tui/import/steps/05-token-reuse/logic.js';

describe('inspectTokens', () => {
  let dir: string;
  let contentfulDir: string;
  let rawTokensPath: string;

  const setAge = async (file: string, secondsAgo: number): Promise<void> => {
    const when = new Date(Date.now() - secondsAgo * 1000);
    await utimes(file, when, when);
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'token-reuse-'));
    contentfulDir = join(dir, 'project', '.contentful');
    rawTokensPath = join(dir, 'raw-tokens.json');
    await mkdir(contentfulDir, { recursive: true });
    await writeFile(rawTokensPath, '{}');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('offers the newest tokens.json from any earlier session, so reuse works across sessions', async () => {
    const older = join(contentfulDir, '10-14-2026-session-1', 'dsi-import-1');
    const newer = join(contentfulDir, '10-15-2026-session-2', 'dsi-import-3');
    await mkdir(older, { recursive: true });
    await mkdir(newer, { recursive: true });
    await writeFile(join(older, 'tokens.json'), '{}');
    await writeFile(join(newer, 'tokens.json'), '{}');
    await setAge(join(older, 'tokens.json'), 600);
    await setAge(join(newer, 'tokens.json'), 60);

    expect(await inspectTokens({ rawTokensPath, contentfulDir, cache: true })).toMatchObject({
      kind: 'cached',
      tokensPath: join(newer, 'tokens.json'),
    });
  });

  it('still finds a tokens.json from before sessions existed', async () => {
    await writeFile(join(contentfulDir, 'tokens.json'), '{}');

    expect(await inspectTokens({ rawTokensPath, contentfulDir, cache: true })).toMatchObject({
      kind: 'cached',
      tokensPath: join(contentfulDir, 'tokens.json'),
    });
  });
});
