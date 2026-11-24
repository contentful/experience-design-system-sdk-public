import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { baseDirProblem, usableBaseDir } from '../../../../src/tui/settings/configuration/project/base-dir.js';
import { readCredentials, writeCredentials } from '../../../../src/tui/settings/configuration/project/project-store.js';

describe('the project settings store', () => {
  let home: string;
  let work: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'eds-home-'));
    work = await mkdtemp(join(tmpdir(), 'eds-work-'));
    process.env['EDS_HOME'] = home;
  });

  afterEach(async () => {
    delete process.env['EDS_HOME'];
    await rm(home, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  });

  const settingsFile = async (): Promise<Record<string, unknown>> =>
    JSON.parse(await readFile(join(home, 'config.json'), 'utf8')) as Record<string, unknown>;

  it('reads path settings saved with a trailing carriage return as the clean path', async () => {
    await writeFile(
      join(home, 'config.json'),
      JSON.stringify({
        spaceId: 'space',
        defaultComponentDir: `${work}/src/components\r`,
        defaultTokenFile: ` ${work}/tokens.json\r\n`,
        contentfulBaseDir: `${work}\r`,
      }),
    );

    const credentials = await readCredentials();

    expect(credentials.defaultComponentDir).toBe(`${work}/src/components`);
    expect(credentials.defaultTokenFile).toBe(`${work}/tokens.json`);
    expect(credentials.contentfulBaseDir).toBe(work);
    expect(credentials.spaceId).toBe('space');
  });

  it('writes path settings without control characters or surrounding whitespace', async () => {
    await writeCredentials({ defaultComponentDir: `${work}/src\r`, contentfulBaseDir: `  ${work}\n` });

    const saved = await settingsFile();
    expect(saved['defaultComponentDir']).toBe(`${work}/src`);
    expect(saved['contentfulBaseDir']).toBe(work);
  });

  it('drops a path setting that is only control characters instead of saving it', async () => {
    await writeCredentials({ contentfulBaseDir: '\r\n' });

    expect(await settingsFile()).not.toHaveProperty('contentfulBaseDir');
  });

  it('accepts a base directory that is a folder or does not exist yet', async () => {
    expect(baseDirProblem(work)).toBeNull();
    expect(baseDirProblem(join(work, 'not-created-yet'))).toBeNull();
    expect(baseDirProblem('')).toBeNull();
  });

  it('rejects a base directory that points to a file', async () => {
    const file = join(work, 'theme.css');
    await writeFile(file, 'body {}');

    expect(baseDirProblem(file)).toBe(
      `The Root Project Directory must be a folder, but ${file} is a file. Use the folder that contains it.`,
    );
  });

  it('only uses a configured base directory that is clean and not a file', async () => {
    const file = join(work, 'theme.css');
    await writeFile(file, 'body {}');

    expect(usableBaseDir(`${work}\r`)).toBe(work);
    expect(usableBaseDir(`${file}\r`)).toBeUndefined();
    expect(usableBaseDir('\r')).toBeUndefined();
    expect(usableBaseDir(42)).toBeUndefined();
    expect(usableBaseDir(undefined)).toBeUndefined();
  });
});
