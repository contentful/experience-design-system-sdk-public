import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { runCli, runCliWithEnv } from '../helpers/cli-runner.js';
import { createMockCMAServer, type MockCMAServer } from '../helpers/mock-cma-server.js';

const componentsPath = resolve(import.meta.dirname, '../fixtures/import/components.json');
const tokensPath = resolve(import.meta.dirname, '../fixtures/valid-tokens.json');

// Use same API paths as push-flags.test.ts — the preview endpoint must include
// 'taxonomies' because isEmptyPreview() destructures it.
const MOCK_ROUTES = {
  'GET /spaces/test-space': {
    sys: { type: 'Space', id: 'test-space', organization: { sys: { id: 'org-123' } } },
  },
  'GET /spaces/test-space/environments/master': {
    sys: { type: 'Environment', id: 'master' },
  },
  'POST /spaces/test-space/environments/master/design_systems/imports/preview': {
    components: { new: [], changed: [], removed: [], unchanged: [] },
    tokens: { new: [], changed: [], removed: [], unchanged: [] },
    taxonomies: { new: [], changed: [], removed: [], unchanged: [] },
  },
};

describe('apply preview — flag variations', () => {
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
    CONTENTFUL_SPACE_ID: '',
    CONTENTFUL_ENVIRONMENT_ID: '',
    CONTENTFUL_MANAGEMENT_TOKEN: '',
  });

  const baseArgs = () => [
    'apply',
    'preview',
    '--components',
    componentsPath,
    '--space-id',
    'test-space',
    '--environment-id',
    'master',
    '--cma-token',
    'test-token',
    '--host',
    server.url,
  ];

  // ── Help ──────────────────────────────────────────────────────────────────

  it('prints help with --help', async () => {
    const { stdout, code } = await runCli(['apply', 'preview', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--space-id');
    expect(stdout).toContain('--environment-id');
    expect(stdout).toContain('--cma-token');
    expect(stdout).toContain('--components');
    expect(stdout).toContain('--tokens');
    expect(stdout).toContain('--session');
    expect(stdout).toContain('--host');
  });

  // ── Missing required flags ────────────────────────────────────────────────

  it('exits non-zero when --space-id is missing', async () => {
    const args = [
      'apply',
      'preview',
      '--components',
      componentsPath,
      '--environment-id',
      'master',
      '--cma-token',
      'tok',
    ];
    const { code, stderr } = await runCliWithEnv(args, baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/space-id/i);
  });

  it('exits non-zero when --environment-id is missing', async () => {
    const args = ['apply', 'preview', '--components', componentsPath, '--space-id', 'test-space', '--cma-token', 'tok'];
    const { code, stderr } = await runCliWithEnv(args, baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/environment-id/i);
  });

  // ── Happy-path: individual file flags ────────────────────────────────────

  it('succeeds with --components pointing to fixture file', async () => {
    const { code } = await runCliWithEnv(baseArgs(), baseEnv());
    expect(code).toBe(0);
  });

  it('succeeds with --tokens pointing to fixture file', async () => {
    const args = [
      'apply',
      'preview',
      '--tokens',
      tokensPath,
      '--space-id',
      'test-space',
      '--environment-id',
      'master',
      '--cma-token',
      'test-token',
      '--host',
      server.url,
    ];
    const { code } = await runCliWithEnv(args, baseEnv());
    expect(code).toBe(0);
  });

  it('succeeds with --components and --tokens combined', async () => {
    const args = [
      'apply',
      'preview',
      '--components',
      componentsPath,
      '--tokens',
      tokensPath,
      '--space-id',
      'test-space',
      '--environment-id',
      'master',
      '--cma-token',
      'test-token',
      '--host',
      server.url,
    ];
    const { code } = await runCliWithEnv(args, baseEnv());
    expect(code).toBe(0);
  });

  // ── --host redirects API calls to mock server ─────────────────────────────

  it('--host redirects API calls to mock server', async () => {
    const requestsBefore = server.requests.length;
    const { code } = await runCliWithEnv(baseArgs(), baseEnv());
    expect(code).toBe(0);
    const newRequests = server.requests.slice(requestsBefore);
    expect(newRequests.length).toBeGreaterThan(0);
    const previewPost = newRequests.find((r) => r.method === 'POST' && r.url.includes('/preview'));
    expect(previewPost).toBeDefined();
  });

  // ── CONTENTFUL_MANAGEMENT_TOKEN env var fallback ──────────────────────────

  it('accepts CMA token from CONTENTFUL_MANAGEMENT_TOKEN env var', async () => {
    const args = [
      'apply',
      'preview',
      '--components',
      componentsPath,
      '--space-id',
      'test-space',
      '--environment-id',
      'master',
      '--host',
      server.url,
      // intentionally no --cma-token
    ];
    const { code } = await runCliWithEnv(args, {
      ...baseEnv(),
      CONTENTFUL_MANAGEMENT_TOKEN: 'env-token',
    });
    expect(code).toBe(0);
  });

  // ── No data flags: exits non-zero (requires at least one source) ──────────

  it('exits non-zero when neither --components nor --tokens nor --session is provided', async () => {
    const args = [
      'apply',
      'preview',
      '--space-id',
      'test-space',
      '--environment-id',
      'master',
      '--cma-token',
      'test-token',
      '--host',
      server.url,
    ];
    const { code, stderr } = await runCliWithEnv(args, baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/components|tokens|session/i);
  });

  // ── Preview does NOT call the apply endpoint ──────────────────────────────

  it('does not POST to the apply endpoint', async () => {
    const requestsBefore = server.requests.length;
    const { code } = await runCliWithEnv(baseArgs(), baseEnv());
    expect(code).toBe(0);
    const applyPosts = server.requests
      .slice(requestsBefore)
      .filter((r) => r.method === 'POST' && r.url.includes('/imports/apply'));
    expect(applyPosts).toHaveLength(0);
  });

  // ── Output is valid JSON in non-TTY mode ──────────────────────────────────

  it('outputs valid JSON preview summary to stdout in non-TTY mode', async () => {
    const { code, stdout } = await runCliWithEnv(baseArgs(), baseEnv());
    expect(code).toBe(0);
    let parsed: unknown;
    expect(() => {
      parsed = JSON.parse(stdout);
    }).not.toThrow();
    expect(parsed).toMatchObject({
      spaceId: 'test-space',
      environmentId: 'master',
      components: expect.objectContaining({ new: 0, changed: 0 }),
      tokens: expect.objectContaining({ new: 0, changed: 0 }),
    });
  });
});
