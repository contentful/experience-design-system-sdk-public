import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateCredentials } from '../../src/tui/import/steps/04-credentials/validate.js';

const values = { spaceId: 'sp', environmentId: 'master', cmaToken: 'tok', host: 'api.contentful.com' };

function respond(...responses: Array<Response | Error>) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe('validateCredentials', () => {
  it('passes when the token and preflight are fine', async () => {
    const fetchMock = respond(new Response('{}', { status: 200 }), new Response('{}', { status: 200 }));
    expect(await validateCredentials(values)).toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.contentful.com/users/me');
    expect(fetchMock.mock.calls[1]![0]).toBe(
      'https://api.contentful.com/spaces/sp/environments/master/design_systems/preflight',
    );
  });

  it('sends the token as a bearer header', async () => {
    const fetchMock = respond(new Response('{}'), new Response('{}'));
    await validateCredentials(values);
    expect(fetchMock.mock.calls[0]![1].headers.Authorization).toBe('Bearer tok');
  });

  it('rejects an invalid token', async () => {
    respond(new Response('', { status: 401 }));
    const result = await validateCredentials(values);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('CMA token is invalid or revoked');
  });

  it('reports an unreachable host', async () => {
    respond(new Error('getaddrinfo ENOTFOUND'));
    const result = await validateCredentials(values);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain('api.contentful.com');
    expect(!result.ok && result.error).toContain('getaddrinfo ENOTFOUND');
  });

  it('rejects an access-denied preflight with the server message', async () => {
    respond(new Response('{}'), json({ sys: { id: 'AccessDenied' }, message: 'No write access' }, 403));
    const result = await validateCredentials(values);
    expect(!result.ok && result.error).toContain('No write access');
  });

  it('rejects a not-found preflight that is an APS denial', async () => {
    respond(new Response('{}'), json({ sys: { id: 'NotFound' } }, 404));
    const result = await validateCredentials(values);
    expect(!result.ok && result.error).toContain('Check the space ID');
  });

  it('lets an older backend without the preflight endpoint through', async () => {
    respond(new Response('{}'), new Response('not found', { status: 404 }));
    expect(await validateCredentials(values)).toEqual({ ok: true });
  });

  it('does not block on a backend 5xx or a preflight network error', async () => {
    respond(new Response('{}'), new Response('', { status: 503 }));
    expect(await validateCredentials(values)).toEqual({ ok: true });
    respond(new Response('{}'), new Error('socket hang up'));
    expect(await validateCredentials(values)).toEqual({ ok: true });
  });

  it('uses the configured EU host', async () => {
    const fetchMock = respond(new Response('{}'), new Response('{}'));
    await validateCredentials({ ...values, host: 'api.eu.contentful.com' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.eu.contentful.com/users/me');
  });
});
