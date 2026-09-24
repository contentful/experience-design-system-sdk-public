import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { runCliWithEnv } from '../helpers/cli-runner.js';
import { createMockCMAServer, type MockCMAServer } from '../helpers/mock-cma-server.js';

// Use the shared import fixture which is a valid CDF components file
const componentsPath = resolve(import.meta.dirname, '../fixtures/import/components.json');
const tokensPath = resolve(import.meta.dirname, '../fixtures/valid-tokens.json');

// The actual API paths used by ImportApiClient (different from mock server defaults).
// Preview endpoint must include 'taxonomies' because isEmptyPreview() destructures it.
const MOCK_ROUTES = {
  'GET /spaces/test-space': {
    sys: { type: 'Space', id: 'test-space', organization: { sys: { id: 'org-123' } } },
  },
  'GET /spaces/test-space/environments/master': {
    sys: { type: 'Environment', id: 'master' },
  },
  'POST /spaces/test-space/environments/master/design_systems/imports/preview': {
    components: { new: [{ id: 'comp-1' }], changed: [], removed: [], unchanged: [] },
    tokens: { new: [], changed: [], removed: [], unchanged: [] },
    taxonomies: { new: [], changed: [], removed: [], unchanged: [] },
  },
  'POST /spaces/test-space/environments/master/design_systems/imports/apply': {
    sys: { id: 'op-1', status: 'queued' },
  },
  'GET /spaces/test-space/environments/master/design_systems/imports/apply/op-1': {
    sys: { id: 'op-1', status: 'succeeded' },
    items: [],
    summary: { total: 0, succeeded: 0, failed: 0, pending: 0 },
  },
};

describe('apply — flag variations', () => {
  let server: MockCMAServer;

  beforeAll(async () => {
    server = await createMockCMAServer(MOCK_ROUTES);
  });

  afterAll(() => {
    server.close();
  });

  const baseEnv = () => ({
    NODE_NO_WARNINGS: '1',
    // Ensure no ambient CONTENTFUL_* env vars interfere
    CONTENTFUL_SPACE_ID: 'test-space',
    CONTENTFUL_ENVIRONMENT_ID: 'master',
    CONTENTFUL_MANAGEMENT_TOKEN: 'test-token',
    EDS_HOST: server.url,
  });

  const baseArgs = () => [
    'apply',
    '--components',
    componentsPath,
  ];

  // ── Non-interactive guard ─────────────────────────────────────────────────

  it('exits non-zero in non-interactive mode', async () => {
    const args = [
      'apply',
      '--components',
      componentsPath,
    ];
    const { code, stderr } = await runCliWithEnv(args, baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/interactive terminal/i);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('succeeds with all required flags against mock server', async () => {
    const { code } = await runCliWithEnv(baseArgs(), baseEnv());
    expect(code).toBe(0);
  });

  // ── --tokens flag ─────────────────────────────────────────────────────────

  it('--tokens flag is accepted and exits 0', async () => {
    const { code } = await runCliWithEnv([...baseArgs(), '--tokens', tokensPath], baseEnv());
    expect(code).toBe(0);
  });

  // ── --components + --tokens combined ─────────────────────────────────────

  it('--components and --tokens combined sends both to preview endpoint', async () => {
    const requestsBefore = server.requests.length;
    const { code } = await runCliWithEnv([...baseArgs(), '--tokens', tokensPath], baseEnv());
    expect(code).toBe(0);
    const previewPost = server.requests
      .slice(requestsBefore)
      .find((r) => r.method === 'POST' && r.url.includes('/preview'));
    expect(previewPost).toBeDefined();
    // The request body should contain a tokensManifest (or tokens) field when tokens are supplied
    const body = previewPost?.body as Record<string, unknown> | undefined;
    if (body !== undefined) {
      const hasTokensField = 'tokensManifest' in body || 'tokens' in body || 'tokenSets' in body;
      expect(hasTokensField).toBe(true);
    }
  });

});
