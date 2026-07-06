import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_CONFIGURED_HOST } from '../src/host-utils.js';

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

    expect(creds.host).toBe('api.eu.contentful.com');
  });

  it('saved host on disk takes precedence over EDS_HOST env var (INTEG-4410)', async () => {
    // Precedence flip: what the operator saved via `experiences setup` or
    // the wizard credentials step must not be silently shadowed by an
    // ambient env var. Env stays as a fallback when the file has nothing.
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

    expect(creds.host).toBe('api.contentful.com');
  });

  it('EDS_HOST env var sets host as a fallback when file is missing', async () => {
    process.env['EDS_HOST'] = 'https://api.eu.contentful.com';
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const creds = await readExperiencesCredentials();

    expect(creds.host).toBe('api.eu.contentful.com');
  });

  it('EDS_HOST env var is used as a fallback when file omits host (INTEG-4410)', async () => {
    process.env['EDS_HOST'] = 'https://api.eu.contentful.com';
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        spaceId: 'abc',
        environmentId: 'master',
        cmaToken: 'tok',
      }),
    );

    const creds = await readExperiencesCredentials();

    expect(creds.host).toBe('api.eu.contentful.com');
  });

  it('falls back to the bare default host display when setup omitted host', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        spaceId: 'abc123',
        environmentId: 'master',
        cmaToken: 'tok',
      }),
    );

    const creds = await readExperiencesCredentials();

    expect(creds.host).toBeUndefined();
    expect(DEFAULT_CONFIGURED_HOST).toBe('api.contentful.com');
  });

  it('saved spaceId/cmaToken on disk take precedence over env vars (INTEG-4410)', async () => {
    // Precedence flip: after the operator runs `experiences setup` or the
    // wizard's credentials step, the values on disk are authoritative. Env
    // vars are only consulted as a fallback (below).
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

    expect(creds.spaceId).toBe('file-space');
    expect(creds.cmaToken).toBe('file-token');
  });

  it('env vars fill in fields the credentials file omits (INTEG-4410)', async () => {
    process.env['CONTENTFUL_SPACE_ID'] = 'env-space';
    process.env['CONTENTFUL_MANAGEMENT_TOKEN'] = 'env-token';
    process.env['CONTENTFUL_ENVIRONMENT_ID'] = 'env-env';
    // File exists but only has environmentId — spaceId and cmaToken empty.
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        spaceId: '',
        environmentId: 'master',
        cmaToken: '',
      }),
    );

    const creds = await readExperiencesCredentials();

    // Disk `master` wins over env because it's non-empty.
    expect(creds.environmentId).toBe('master');
    // Empty disk values fall through to the env vars.
    expect(creds.spaceId).toBe('env-space');
    expect(creds.cmaToken).toBe('env-token');
  });

  it('round-trip: write then read returns the written spaceId, unaffected by CONTENTFUL_SPACE_ID being unset (INTEG-4410)', async () => {
    // Guards the disk-wins-over-env contract end-to-end. Companion to the
    // "override" test above.
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    await writeExperiencesCredentials({
      spaceId: 'X',
      environmentId: 'master',
      cmaToken: 'tok',
    });
    const written = mockWriteFile.mock.calls[0][1] as string;
    mockReadFile.mockResolvedValue(written);

    const creds = await readExperiencesCredentials();
    expect(creds.spaceId).toBe('X');
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
    expect(written.host).toBe('api.eu.contentful.com');
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

  it('round-trips selectPromptPath and generatePromptPath (Feature 8)', async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    await writeExperiencesCredentials({
      spaceId: 'space1',
      environmentId: 'master',
      cmaToken: 'token',
      selectPromptPath: '/custom/select.md',
      generatePromptPath: '/custom/generate.md',
    });

    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as Record<string, unknown>;
    expect(written.selectPromptPath).toBe('/custom/select.md');
    expect(written.generatePromptPath).toBe('/custom/generate.md');

    // Read back
    mockReadFile.mockResolvedValue(JSON.stringify(written));
    const creds = await readExperiencesCredentials();
    expect(creds.selectPromptPath).toBe('/custom/select.md');
    expect(creds.generatePromptPath).toBe('/custom/generate.md');
  });

  it('omits selectPromptPath / generatePromptPath when undefined (Feature 8)', async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    await writeExperiencesCredentials({
      spaceId: 'space1',
      environmentId: 'master',
      cmaToken: 'token',
    });

    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as Record<string, unknown>;
    expect(written).not.toHaveProperty('selectPromptPath');
    expect(written).not.toHaveProperty('generatePromptPath');
  });
});

describe('ExperiencesCredentials.autoFilter round-trip', () => {
  it('returns autoFilter undefined when the field is absent from the file', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        spaceId: 'abc',
        environmentId: 'master',
        cmaToken: 'tok',
      }),
    );

    const creds = await readExperiencesCredentials();

    expect(creds.autoFilter).toBeUndefined();
  });

  it('reads autoFilter:false from the file', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        spaceId: 'abc',
        environmentId: 'master',
        cmaToken: 'tok',
        autoFilter: false,
      }),
    );

    const creds = await readExperiencesCredentials();

    expect(creds.autoFilter).toBe(false);
  });

  it('reads autoFilter:true from the file', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({
        spaceId: 'abc',
        environmentId: 'master',
        cmaToken: 'tok',
        autoFilter: true,
      }),
    );

    const creds = await readExperiencesCredentials();

    expect(creds.autoFilter).toBe(true);
  });

  it('writes autoFilter:false when set', async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    await writeExperiencesCredentials({
      spaceId: 'space1',
      environmentId: 'master',
      cmaToken: 'token',
      autoFilter: false,
    });

    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as Record<string, unknown>;
    expect(written.autoFilter).toBe(false);
  });

  it('omits autoFilter from the written JSON when undefined', async () => {
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    await writeExperiencesCredentials({
      spaceId: 'space1',
      environmentId: 'master',
      cmaToken: 'token',
    });

    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string) as Record<string, unknown>;
    expect(written).not.toHaveProperty('autoFilter');
  });
});
