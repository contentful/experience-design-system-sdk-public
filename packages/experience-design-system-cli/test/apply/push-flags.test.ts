import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { runCli, runCliWithEnv } from '../helpers/cli-runner.js';
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
    components: { new: [], changed: [], removed: [], unchanged: [] },
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

describe('apply push — flag variations', () => {
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
    'push',
    '--components',
    componentsPath,
    '--space-id',
    'test-space',
    '--environment-id',
    'master',
    '--cma-token',
    'test-token',
    '--yes',
    '--host',
    server.url,
  ];

  // ── Help ──────────────────────────────────────────────────────────────────

  it('prints help with --help', async () => {
    const { stdout, code } = await runCli(['apply', 'push', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--space-id');
    expect(stdout).toContain('--environment-id');
    expect(stdout).toContain('--cma-token');
  });

  // ── Non-interactive guard ─────────────────────────────────────────────────

  it('exits non-zero in non-TTY mode without --yes', async () => {
    const args = [
      'apply',
      'push',
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
    const { code, stderr } = await runCliWithEnv(args, baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/--yes/i);
  });

  // ── Missing required credentials ──────────────────────────────────────────

  const missingCredentials = [
    {
      name: 'missing --space-id',
      args: [
        'apply',
        'push',
        '--components',
        componentsPath,
        '--environment-id',
        'master',
        '--cma-token',
        'tok',
        '--yes',
      ],
      expectStderr: /space-id/i,
    },
    {
      name: 'missing --environment-id',
      args: ['apply', 'push', '--components', componentsPath, '--space-id', 's1', '--cma-token', 'tok', '--yes'],
      expectStderr: /environment-id/i,
    },
    {
      name: 'missing --cma-token',
      args: [
        'apply',
        'push',
        '--components',
        componentsPath,
        '--space-id',
        's1',
        '--environment-id',
        'master',
        '--yes',
      ],
      expectStderr: /cma.?token|token/i,
    },
  ];

  it.each(missingCredentials)('exits non-zero when $name', async ({ args, expectStderr }) => {
    const { code, stderr } = await runCliWithEnv(args, baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toMatch(expectStderr);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('succeeds with all required flags against mock server', async () => {
    const { code } = await runCliWithEnv(baseArgs(), baseEnv());
    expect(code).toBe(0);
  });

  // ── --dry-run does not POST to import ─────────────────────────────────────

  it('--dry-run does not make import POST requests', async () => {
    const requestsBefore = server.requests.length;
    const { code } = await runCliWithEnv([...baseArgs(), '--dry-run'], baseEnv());
    expect(code).toBe(0);
    const importPosts = server.requests
      .slice(requestsBefore)
      .filter((r) => r.method === 'POST' && r.url.includes('/imports/apply'));
    expect(importPosts).toHaveLength(0);
  });

  // ── --dry-run still calls preview ─────────────────────────────────────────

  it('--dry-run calls the preview endpoint', async () => {
    const requestsBefore = server.requests.length;
    const { code } = await runCliWithEnv([...baseArgs(), '--dry-run'], baseEnv());
    expect(code).toBe(0);
    const previewPosts = server.requests
      .slice(requestsBefore)
      .filter((r) => r.method === 'POST' && r.url.includes('/preview'));
    expect(previewPosts.length).toBeGreaterThan(0);
  });

  // ── --tokens flag ─────────────────────────────────────────────────────────

  it('--tokens flag is accepted and exits 0', async () => {
    const { code } = await runCliWithEnv([...baseArgs(), '--tokens', tokensPath], baseEnv());
    expect(code).toBe(0);
  });

  // ── --verbose flag ────────────────────────────────────────────────────────

  it('--verbose flag is accepted and exits 0', async () => {
    const { code } = await runCliWithEnv([...baseArgs(), '--verbose'], baseEnv());
    expect(code).toBe(0);
  });

  // ── --force flag ──────────────────────────────────────────────────────────

  it('--force skips breaking change confirmation and exits 0', async () => {
    const { code } = await runCliWithEnv([...baseArgs(), '--force'], baseEnv());
    expect(code).toBe(0);
  });

  it('--force combined with --dry-run exits 0', async () => {
    const { code } = await runCliWithEnv([...baseArgs(), '--force', '--dry-run'], baseEnv());
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

  // ── CONTENTFUL_MANAGEMENT_TOKEN env var fallback ──────────────────────────

  it('uses CONTENTFUL_MANAGEMENT_TOKEN env var when --cma-token is not passed', async () => {
    // Strip --cma-token and its value from baseArgs
    const args = baseArgs().filter((arg, i, arr) => {
      if (arg === '--cma-token') return false;
      if (i > 0 && arr[i - 1] === '--cma-token') return false;
      return true;
    });
    const { code } = await runCliWithEnv(args, {
      ...baseEnv(),
      CONTENTFUL_MANAGEMENT_TOKEN: 'env-token',
    });
    expect(code).toBe(0);
  });
});
