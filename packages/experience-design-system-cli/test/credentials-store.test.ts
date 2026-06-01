import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mock fns so they are available inside the vi.mock factory ────────

const { mockReadFile, mockWriteFile, mockMkdir } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
  mockWriteFile: vi.fn(),
  mockMkdir: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

// ── Import after mocks ─────────────────────────────────────────────────────

import { readExperiencesCredentials, writeExperiencesCredentials } from '../src/credentials-store.js';

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env['CONTENTFUL_SPACE_ID'];
  delete process.env['CONTENTFUL_ENVIRONMENT_ID'];
  delete process.env['CONTENTFUL_MANAGEMENT_TOKEN'];
  delete process.env['EDS_HOST'];
});

describe('readExperiencesCredentials', () => {
  it('returns empty strings when credentials file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const creds = await readExperiencesCredentials();

    expect(creds.spaceId).toBe('');
    expect(creds.environmentId).toBe('');
    expect(creds.cmaToken).toBe('');
    expect(creds.host).toBeUndefined();
  });

  it('returns values from saved credentials file', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        spaceId: 'abc123',
        environmentId: 'master',
        cmaToken: 'tok',
      }),
    );

    const creds = await readExperiencesCredentials();

    expect(creds.spaceId).toBe('abc123');
    expect(creds.environmentId).toBe('master');
    expect(creds.cmaToken).toBe('tok');
    expect(creds.host).toBeUndefined();
  });

  it('reads host from saved credentials file', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        spaceId: 'abc123',
        environmentId: 'master',
        cmaToken: 'tok',
        host: 'https://api.eu.contentful.com',
      }),
    );

    const creds = await readExperiencesCredentials();

    expect(creds.host).toBe('https://api.eu.contentful.com');
  });

  it('EDS_HOST env var overrides saved host', async () => {
    process.env['EDS_HOST'] = 'https://api.eu.contentful.com';
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        spaceId: 'abc',
        environmentId: 'master',
        cmaToken: 'tok',
        host: 'https://api.contentful.com',
      }),
    );

    const creds = await readExperiencesCredentials();

    expect(creds.host).toBe('https://api.eu.contentful.com');
  });

  it('EDS_HOST env var sets host even when file is missing', async () => {
    process.env['EDS_HOST'] = 'https://api.eu.contentful.com';
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const creds = await readExperiencesCredentials();

    expect(creds.host).toBe('https://api.eu.contentful.com');
  });

  it('env vars override saved spaceId and cmaToken', async () => {
    process.env['CONTENTFUL_SPACE_ID'] = 'env-space';
    process.env['CONTENTFUL_MANAGEMENT_TOKEN'] = 'env-token';
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        spaceId: 'file-space',
        environmentId: 'master',
        cmaToken: 'file-token',
      }),
    );

    const creds = await readExperiencesCredentials();

    expect(creds.spaceId).toBe('env-space');
    expect(creds.cmaToken).toBe('env-token');
  });
});

describe('writeExperiencesCredentials', () => {
  it('writes credentials including host to JSON file', async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    await writeExperiencesCredentials({
      spaceId: 'space1',
      environmentId: 'master',
      cmaToken: 'token',
      host: 'https://api.eu.contentful.com',
    });

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as Record<string, unknown>;
    expect(written.spaceId).toBe('space1');
    expect(written.host).toBe('https://api.eu.contentful.com');
  });

  it('writes credentials without host when host is undefined', async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    await writeExperiencesCredentials({
      spaceId: 'space1',
      environmentId: 'master',
      cmaToken: 'token',
    });

    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as Record<string, unknown>;
    expect(written).not.toHaveProperty('host');
  });
});
