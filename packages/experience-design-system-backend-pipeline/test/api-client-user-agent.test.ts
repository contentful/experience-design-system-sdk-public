import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../src/steps/apply/src/helpers/api-client/api-client.js';
import { USER_AGENT } from '../src/steps/apply/src/constants/index.js';

const HEADER = 'x-contentful-user-agent';
const CLI_AGENT = 'app contentful.experience-design-system-cli/2.38.0; platform node.js/v22.0.0; os macOS/v22.0.0;';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

afterEach(() => {
  mockFetch.mockReset();
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const client = (userAgent?: string): ApiClient =>
  new ApiClient({
    cmaToken: 'token',
    spaceId: 'space1',
    environmentId: 'master',
    ...(userAgent === undefined ? {} : { userAgent }),
  });

/** The header of every request the client made, whether it passed `fetch` a URL and options or a built Request. */
function sentUserAgents(): Array<string | null> {
  return mockFetch.mock.calls.map(([input, init]) => {
    if (input instanceof Request) return input.headers.get(HEADER);
    return new Headers((init as RequestInit | undefined)?.headers).get(HEADER);
  });
}

describe('the User-Agent the API client sends', () => {
  it('is this package by default, so callers that never set one send what they always did', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(json(200, {})));

    await client().validateToken();

    expect(sentUserAgents()).toEqual([USER_AGENT, USER_AGENT]);
  });

  it('is the one the caller gave, on token validation and on the preflight check after it', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(json(200, {})));

    await client(CLI_AGENT).validateToken();

    expect(sentUserAgents()).toEqual([CLI_AGENT, CLI_AGENT]);
  });

  it('is the one the caller gave, on a preview', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(json(200, { components: { created: [], updated: [], removed: [], unchanged: [] } })),
    );

    await client(CLI_AGENT).previewImport({ $schema: 'x' } as never);

    expect(sentUserAgents()).toEqual([CLI_AGENT]);
  });

  it('is the one the caller gave, on an apply', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(json(202, { sys: { id: 'op1', status: 'pending' } })));

    await client(CLI_AGENT).applyImport({ $schema: 'x' } as never, { acknowledgeBreakingChanges: false });

    expect(sentUserAgents()).toEqual([CLI_AGENT]);
  });

  it('is the one the caller gave, on every poll', async () => {
    mockFetch.mockImplementationOnce(() => Promise.resolve(json(200, { sys: { id: 'op1', status: 'pending' } })));
    mockFetch.mockImplementationOnce(() => Promise.resolve(json(200, { sys: { id: 'op1', status: 'succeeded' } })));

    await client(CLI_AGENT).pollOperation('op1', { intervalMs: 1, maxIntervalMs: 1 });

    expect(sentUserAgents()).toEqual([CLI_AGENT, CLI_AGENT]);
  });

  it('is kept per client, so one caller choosing its own does not change another', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(json(200, {})));
    const withAgent = client(CLI_AGENT);
    const withoutAgent = client();

    await withAgent.checkPreflight();
    await withoutAgent.checkPreflight();

    expect(sentUserAgents()).toEqual([CLI_AGENT, USER_AGENT]);
  });
});
