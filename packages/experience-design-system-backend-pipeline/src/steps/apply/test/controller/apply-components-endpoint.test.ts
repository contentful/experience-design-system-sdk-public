import { describe, expect, it } from 'vitest';
import { applyComponents } from '../../src/controller/endpoint/apply-components-endpoint.js';

const validCredentials = {
  accessToken: 'token',
  spaceId: 'space123',
  environmentId: 'master',
};

describe('applyComponents validation', () => {
  it('throws when accessToken is missing', async () => {
    await expect(
      applyComponents({ components: [], credentials: { ...validCredentials, accessToken: '' } }),
    ).rejects.toThrow('credentials.accessToken is required');
  });

  it('throws when spaceId is missing', async () => {
    await expect(
      applyComponents({ components: [], credentials: { ...validCredentials, spaceId: '' } }),
    ).rejects.toThrow('credentials.spaceId is required');
  });

  it('throws when environmentId is missing', async () => {
    await expect(
      applyComponents({ components: [], credentials: { ...validCredentials, environmentId: '' } }),
    ).rejects.toThrow('credentials.environmentId is required');
  });

  it('passes validation and delegates to service with valid credentials', async () => {
    await expect(applyComponents({ components: [], credentials: validCredentials })).rejects.toThrow(
      'nothing to push — no components or tokens resolved',
    );
  });
});
