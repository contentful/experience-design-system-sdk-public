import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ImportApiClient,
  ApiError,
  parsePreviewValidationErrors,
  PREVIEW_ERROR_PREFIX,
  APPLY_ERROR_PREFIX,
} from '../../src/apply/api-client.js';
import type { ServerPreviewResponse, ApplyOperationResponse } from '@contentful/experience-design-system-types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

afterEach(() => {
  vi.resetAllMocks();
});

function createClient() {
  return new ImportApiClient({
    cmaToken: 'test-token',
    spaceId: 'space1',
    environmentId: 'master',
  });
}

describe('ImportApiClient — validateToken', () => {
  it('calls GET /users/me to verify the token', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({ sys: { type: 'User', id: 'user-1' } }),
      text: () => Promise.resolve(''),
    });

    const client = createClient();
    await client.validateToken();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.contentful.com/users/me');
  });

  it('throws ApiError on 401', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
      text: () =>
        Promise.resolve(JSON.stringify({ sys: { type: 'Error', id: 'AccessTokenInvalid' }, message: 'Invalid token' })),
    });

    const client = createClient();
    await expect(client.validateToken()).rejects.toThrow(/CMA token is invalid or revoked/);
  });

  it('does not 401 for tokens that lack space-membership but can call design-systems endpoints', async () => {
    // Regression: /users/me does not enforce per-space role assignments, so it succeeds for any
    // valid token regardless of space access. This is by design — the design-systems API
    // performs its own org-level entitlement check on previewImport/applyImport.
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({ sys: { type: 'User', id: 'user-1' } }),
      text: () => Promise.resolve(''),
    });

    const client = createClient();
    await expect(client.validateToken()).resolves.toBeUndefined();
  });

  it('uses the provided host when overridden', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({ sys: { type: 'User', id: 'user-1' } }),
      text: () => Promise.resolve(''),
    });

    const client = new ImportApiClient({
      cmaToken: 'test-token',
      spaceId: 'fhuxdukarhrp',
      environmentId: 'master',
      host: 'https://mock-api.example.com',
    });
    await client.validateToken();

    expect(mockFetch.mock.calls[0][0]).toBe('https://mock-api.example.com/users/me');
  });

  it('adds https:// when the provided host omits a scheme', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({ sys: { type: 'User', id: 'user-1' } }),
      text: () => Promise.resolve(''),
    });

    const client = new ImportApiClient({
      cmaToken: 'test-token',
      spaceId: 'fhuxdukarhrp',
      environmentId: 'master',
      host: 'api.eu.contentful.com',
    });
    await client.validateToken();

    expect(mockFetch.mock.calls[0][0]).toBe('https://api.eu.contentful.com/users/me');
  });

  it('throws ApiError on unexpected non-200', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: new Headers(),
      text: () => Promise.resolve('Internal Server Error'),
    });

    const client = createClient();
    await expect(client.validateToken()).rejects.toThrow(ApiError);
  });

  it('sends X-Contentful-User-Agent identifying the DSI CLI', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => Promise.resolve({ sys: { type: 'User', id: 'user-1' } }),
      text: () => Promise.resolve(''),
    });

    const client = createClient();
    await client.validateToken();

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders['X-Contentful-User-Agent']).toMatch(/^app contentful\.experience-design-system-cli\//);
  });
});

describe('ImportApiClient — previewImport', () => {
  it('sends POST with manifest body and returns parsed response', async () => {
    const serverResponse: ServerPreviewResponse = {
      components: { new: [], changed: [], unchanged: [], removed: [] },
      tokens: { new: [], changed: [], unchanged: [], removed: [] },
      taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(serverResponse),
      text: () => Promise.resolve(JSON.stringify(serverResponse)),
    });

    const client = createClient();
    const result = await client.previewImport({
      componentsManifest: { Button: {} },
    });

    expect(result).toEqual(serverResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.contentful.com/spaces/space1/environments/master/design_systems/imports/preview',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ componentsManifest: { Button: {} } }),
      }),
    );
  });

  it('throws ApiError on non-200 response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"message":"At least one manifest field required"}'),
    });

    const client = createClient();
    await expect(client.previewImport({})).rejects.toThrow(ApiError);
  });

  it('does not send x-contentful-organization-id header (server resolves org from space)', async () => {
    const serverResponse: ServerPreviewResponse = {
      components: { new: [], changed: [], unchanged: [], removed: [] },
      tokens: { new: [], changed: [], unchanged: [], removed: [] },
      taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(serverResponse),
      text: () => Promise.resolve(''),
    });

    const client = createClient();
    await client.previewImport({ tokensManifest: {} });

    const callHeaders = mockFetch.mock.calls[0][1].headers;
    expect(callHeaders['x-contentful-organization-id']).toBeUndefined();
  });

  it('drops malformed breaking-change entries (neither propertyId nor slotId, or unknown reason) and keeps valid ones', async () => {
    const serverResponse = {
      components: {
        new: [],
        changed: [
          {
            current: { id: 'c', name: 'Card', contentProperties: [], designProperties: [], slots: [] },
            proposed: { $type: 'component', $properties: {} },
            hasPendingDraftChanges: false,
            changeClassification: {
              classification: 'breaking',
              breakingChanges: [
                { propertyId: 'variant', reason: 'removed' },
                { slotId: 'footer', reason: 'slot_removed' },
                { reason: 'weird' },
                { propertyId: 'x', reason: 'not_a_real_reason' },
              ],
            },
          },
        ],
        unchanged: [],
        removed: [],
      },
      tokens: { new: [], changed: [], unchanged: [], removed: [] },
      taxonomies: { new: [], changed: [], unchanged: [], removed: [] },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(serverResponse),
      text: () => Promise.resolve(''),
    });

    const client = createClient();
    const result = await client.previewImport({ componentsManifest: {} });
    const changes = result.components.changed[0].changeClassification?.breakingChanges ?? [];
    expect(changes).toEqual([
      { propertyId: 'variant', reason: 'removed' },
      { slotId: 'footer', reason: 'slot_removed' },
    ]);
  });
});

describe('ImportApiClient — applyImport', () => {
  it('sends POST with manifest + acknowledgeBreakingChanges and returns 202 response', async () => {
    const opResponse: ApplyOperationResponse = {
      sys: {
        type: 'ApplyOperation',
        id: 'op-1',
        status: 'queued',
        createdAt: '2026-01-01T00:00:00Z',
        createdBy: { sys: { type: 'Link', linkType: 'User', id: 'user-1' } },
      },
      summary: { total: 2, pending: 2, succeeded: 0, failed: 0 },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 202,
      json: () => Promise.resolve(opResponse),
      text: () => Promise.resolve(JSON.stringify(opResponse)),
    });

    const client = createClient();
    const result = await client.applyImport({ componentsManifest: { Button: {} } }, true);

    expect(result).toEqual(opResponse);
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.acknowledgeBreakingChanges).toBe(true);
  });

  it('throws ApiError with gate details on 422', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            sys: { type: 'Error', id: 'UnprocessableEntity' },
            message: 'Breaking changes require acknowledgement',
            details: { breakingComponentIds: ['Button'], affectedEntities: 5 },
          }),
        ),
    });

    const client = createClient();
    await expect(client.applyImport({ componentsManifest: { Button: {} } }, false)).rejects.toThrow(ApiError);
  });
});

describe('ImportApiClient — pollOperation', () => {
  it('returns immediately when operation is in terminal state', async () => {
    const finalOp: ApplyOperationResponse = {
      sys: {
        type: 'ApplyOperation',
        id: 'op-1',
        status: 'succeeded',
        createdAt: '2026-01-01T00:00:00Z',
        createdBy: { sys: { type: 'Link', linkType: 'User', id: 'user-1' } },
      },
      summary: { total: 2, pending: 0, succeeded: 2, failed: 0 },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(finalOp),
      text: () => Promise.resolve(JSON.stringify(finalOp)),
    });

    const client = createClient();
    const result = await client.pollOperation('op-1');

    expect(result.sys.status).toBe('succeeded');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('polls until terminal state is reached', async () => {
    const queuedOp: ApplyOperationResponse = {
      sys: {
        type: 'ApplyOperation',
        id: 'op-1',
        status: 'queued',
        createdAt: '2026-01-01T00:00:00Z',
        createdBy: { sys: { type: 'Link', linkType: 'User', id: 'user-1' } },
      },
      summary: { total: 2, pending: 2, succeeded: 0, failed: 0 },
    };
    const succeededOp: ApplyOperationResponse = {
      sys: {
        type: 'ApplyOperation',
        id: 'op-1',
        status: 'succeeded',
        createdAt: '2026-01-01T00:00:00Z',
        createdBy: { sys: { type: 'Link', linkType: 'User', id: 'user-1' } },
      },
      summary: { total: 2, pending: 0, succeeded: 2, failed: 0 },
    };

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(queuedOp),
        text: () => Promise.resolve(''),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(succeededOp),
        text: () => Promise.resolve(''),
      });

    const client = createClient();
    const result = await client.pollOperation('op-1', {
      intervalMs: 10,
      maxAttempts: 5,
    });

    expect(result.sys.status).toBe('succeeded');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after max attempts exceeded', async () => {
    const runningOp: ApplyOperationResponse = {
      sys: {
        type: 'ApplyOperation',
        id: 'op-1',
        status: 'running',
        createdAt: '2026-01-01T00:00:00Z',
        createdBy: { sys: { type: 'Link', linkType: 'User', id: 'user-1' } },
      },
      summary: { total: 2, pending: 1, succeeded: 1, failed: 0 },
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(runningOp),
      text: () => Promise.resolve(''),
    });

    const client = createClient();
    await expect(client.pollOperation('op-1', { intervalMs: 10, maxAttempts: 3 })).rejects.toThrow('timed out');
  });

  it('throws ApiError on non-200 poll response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"message":"Operation not found"}'),
    });

    const client = createClient();
    await expect(client.pollOperation('op-1')).rejects.toThrow(ApiError);
  });
});

describe('parsePreviewValidationErrors', () => {
  it('extracts component name, path, and message from a slot-path error', () => {
    const body = JSON.stringify({
      sys: { type: 'Error', id: 'ValidationFailed' },
      message: 'Validation error',
      details: {
        errors: [{ path: 'manifest:components/PageLink/$slots/', message: 'Slot id must be a non-empty string' }],
      },
    });
    const result = parsePreviewValidationErrors(body);
    expect(result).toEqual([
      {
        componentName: 'PageLink',
        path: 'manifest:components/PageLink/$slots/',
        message: 'Slot id must be a non-empty string',
      },
    ]);
  });

  it('extracts component name from a properties-path error', () => {
    const body = JSON.stringify({
      details: {
        errors: [{ path: 'manifest:components/Button/$properties/variant', message: 'variant required' }],
      },
    });
    const result = parsePreviewValidationErrors(body);
    expect(result).toEqual([
      {
        componentName: 'Button',
        path: 'manifest:components/Button/$properties/variant',
        message: 'variant required',
      },
    ]);
  });

  it('returns multiple entries when the body lists multiple errors', () => {
    const body = JSON.stringify({
      details: {
        errors: [
          { path: 'manifest:components/PageLink/$slots/', message: 'Slot id must be a non-empty string' },
          { path: 'manifest:components/Button/$properties/variant', message: 'variant required' },
        ],
      },
    });
    const result = parsePreviewValidationErrors(body);
    expect(result.map((e) => e.componentName)).toEqual(['PageLink', 'Button']);
  });

  it('returns [] for malformed JSON', () => {
    expect(parsePreviewValidationErrors('not json')).toEqual([]);
  });

  it('returns [] when details.errors is missing', () => {
    expect(parsePreviewValidationErrors(JSON.stringify({ message: 'oops' }))).toEqual([]);
  });

  it('returns [] when details.errors is not an array', () => {
    expect(parsePreviewValidationErrors(JSON.stringify({ details: { errors: 'nope' } }))).toEqual([]);
  });

  it('skips entries whose path does not start with manifest:components/', () => {
    const body = JSON.stringify({
      details: {
        errors: [
          { path: 'manifest:tokens/foo', message: 'unrelated' },
          { path: 'manifest:components/Good/$slots/', message: 'real' },
        ],
      },
    });
    const result = parsePreviewValidationErrors(body);
    expect(result).toEqual([{ componentName: 'Good', path: 'manifest:components/Good/$slots/', message: 'real' }]);
  });

  it('skips entries with non-string path or message', () => {
    const body = JSON.stringify({
      details: {
        errors: [
          { path: null, message: 'no path' },
          { path: 'manifest:components/Good/', message: 42 },
        ],
      },
    });
    expect(parsePreviewValidationErrors(body)).toEqual([]);
  });

  it('handles a path with no trailing field segment', () => {
    const body = JSON.stringify({
      details: {
        errors: [{ path: 'manifest:components/SoloComp', message: 'top-level' }],
      },
    });
    const result = parsePreviewValidationErrors(body);
    expect(result).toEqual([{ componentName: 'SoloComp', path: 'manifest:components/SoloComp', message: 'top-level' }]);
  });

  it('returns [] for empty body string', () => {
    expect(parsePreviewValidationErrors('')).toEqual([]);
  });

  it('returns [] for null/undefined/primitive entries in errors[]', () => {
    const body = JSON.stringify({
      details: {
        errors: [null, undefined, 5, 'string', { path: 'manifest:components/Good/$slots/', message: 'real' }],
      },
    });
    const result = parsePreviewValidationErrors(body);
    expect(result).toEqual([{ componentName: 'Good', path: 'manifest:components/Good/$slots/', message: 'real' }]);
  });

  it('returns [] for top-level non-object parsed bodies (null, primitive)', () => {
    expect(parsePreviewValidationErrors('null')).toEqual([]);
    expect(parsePreviewValidationErrors('42')).toEqual([]);
    expect(parsePreviewValidationErrors('"hello"')).toEqual([]);
  });
});

describe('phase-prefix constants — orchestrator contract', () => {
  it('previewImport throws ApiError whose message starts with PREVIEW_ERROR_PREFIX on non-200', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            sys: { type: 'Error', id: 'ValidationFailed' },
            message: 'Validation error',
            details: { errors: [] },
          }),
        ),
    });

    const client = createClient();
    try {
      await client.previewImport({});
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).message).toMatch(new RegExp(`^${PREVIEW_ERROR_PREFIX}`));
    }
  });

  it('applyImport throws ApiError whose message starts with APPLY_ERROR_PREFIX on non-200', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 422,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            sys: { type: 'Error', id: 'UnprocessableEntity' },
            message: 'Breaking changes',
          }),
        ),
    });

    const client = createClient();
    try {
      await client.applyImport({}, false);
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).message).toMatch(new RegExp(`^${APPLY_ERROR_PREFIX}`));
    }
  });

  it('PREVIEW_ERROR_PREFIX and APPLY_ERROR_PREFIX are distinct strings', () => {
    expect(PREVIEW_ERROR_PREFIX).not.toBe(APPLY_ERROR_PREFIX);
    expect(PREVIEW_ERROR_PREFIX).toContain('preview');
    expect(APPLY_ERROR_PREFIX).toContain('apply');
  });
});

describe('ApiError — body preservation for orchestrator retry parsing', () => {
  function makeValidationFailedBody(errorCount: number): string {
    return JSON.stringify({
      sys: { type: 'Error', id: 'ValidationFailed' },
      message: 'Validation error',
      details: {
        errors: Array.from({ length: errorCount }, (_, i) => ({
          path: `manifest:components/Component${i}/$slots/`,
          message: `Slot id must be a non-empty string for Component${i}`,
        })),
      },
    });
  }

  it('keeps a 2KB body parseable as JSON in e.message — orchestrator retry parses from stderr', () => {
    // The orchestrator pipes the subprocess stderr (which contains e.message
    // verbatim via die()) through parsePreviewValidationErrors. If ApiError
    // truncates the body mid-JSON, the parser fails and the retry loop gives
    // up — no exclusion, no recovery. Anything above ~10 component errors
    // exceeds the original 1000-char trim cap.
    const body = makeValidationFailedBody(20);
    expect(body.length).toBeGreaterThan(1000); // sanity — confirms we're testing the truncation case

    const err = new ApiError(`${PREVIEW_ERROR_PREFIX} 422`, 422, body);

    // The body portion must remain valid JSON so JSON.parse succeeds.
    const newlineIdx = err.message.indexOf('\n');
    expect(newlineIdx).toBeGreaterThan(-1);
    const bodyPart = err.message.slice(newlineIdx + 1);
    expect(() => JSON.parse(bodyPart)).not.toThrow();
  });

  it('still trims pathologically large bodies (>16KB) so a runaway server response cannot exhaust memory in logs', () => {
    // Bound: keep the cap; just raise it from 1000 to something realistic.
    // Anything beyond ~16KB is almost certainly a runaway response, not a
    // real validation report.
    const huge = makeValidationFailedBody(500); // ~50KB
    expect(huge.length).toBeGreaterThan(20000);

    const err = new ApiError(`${PREVIEW_ERROR_PREFIX} 422`, 422, huge);

    // Must be capped (i.e. truncated), but the cap must be high enough to
    // accommodate realistic 422 reports.
    expect(err.message.length).toBeLessThan(huge.length);
    expect(err.message.length).toBeGreaterThan(10000);
  });
});
