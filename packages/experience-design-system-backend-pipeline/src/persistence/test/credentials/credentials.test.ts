import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readExperiencesCredentials,
  writeExperiencesCredentials,
  experiencesCredentialsPath,
} from '../../src/credentials/index.js';

describe('credentials store', () => {
  let home: string;
  const prevEdsHome = process.env['EDS_HOME'];
  const prevSpace = process.env['CONTENTFUL_SPACE_ID'];
  const prevEnv = process.env['CONTENTFUL_ENVIRONMENT_ID'];
  const prevToken = process.env['CONTENTFUL_MANAGEMENT_TOKEN'];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'eds-creds-'));
    process.env['EDS_HOME'] = home;
    delete process.env['CONTENTFUL_SPACE_ID'];
    delete process.env['CONTENTFUL_ENVIRONMENT_ID'];
    delete process.env['CONTENTFUL_MANAGEMENT_TOKEN'];
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (prevEdsHome === undefined) delete process.env['EDS_HOME'];
    else process.env['EDS_HOME'] = prevEdsHome;
    if (prevSpace !== undefined) process.env['CONTENTFUL_SPACE_ID'] = prevSpace;
    if (prevEnv !== undefined) process.env['CONTENTFUL_ENVIRONMENT_ID'] = prevEnv;
    if (prevToken !== undefined) process.env['CONTENTFUL_MANAGEMENT_TOKEN'] = prevToken;
  });

  it('round-trips credentials through config.json', async () => {
    await writeExperiencesCredentials({
      spaceId: 'space1',
      environmentId: 'master',
      cmaToken: 'token1',
      host: 'api.contentful.com',
    });
    const read = await readExperiencesCredentials();
    expect(read.spaceId).toBe('space1');
    expect(read.environmentId).toBe('master');
    expect(read.cmaToken).toBe('token1');
    expect(read.host).toBe('api.contentful.com');
  });

  it('falls back to env vars when config is missing', async () => {
    process.env['CONTENTFUL_SPACE_ID'] = 'env-space';
    process.env['CONTENTFUL_ENVIRONMENT_ID'] = 'env-master';
    process.env['CONTENTFUL_MANAGEMENT_TOKEN'] = 'env-token';
    const read = await readExperiencesCredentials();
    expect(read.spaceId).toBe('env-space');
    expect(read.environmentId).toBe('env-master');
    expect(read.cmaToken).toBe('env-token');
  });

  it('writes config.json with 0600 mode (not world-readable)', async () => {
    await writeExperiencesCredentials({
      spaceId: 's',
      environmentId: 'e',
      cmaToken: 't',
    });
    const path = experiencesCredentialsPath();
    const content = readFileSync(path, 'utf8');
    expect(JSON.parse(content)).toMatchObject({ spaceId: 's', environmentId: 'e', cmaToken: 't' });
  });

  it('clears owned keys on overwrite so emptied values vanish', async () => {
    await writeExperiencesCredentials({
      spaceId: 's',
      environmentId: 'e',
      cmaToken: 't',
      agent: 'claude',
    });
    await writeExperiencesCredentials({
      spaceId: 's',
      environmentId: 'e',
      cmaToken: 't',
    });
    const read = await readExperiencesCredentials();
    expect(read.agent).toBeUndefined();
  });
});
