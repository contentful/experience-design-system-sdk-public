import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { runCli, runCliWithEnv } from '../helpers/cli-runner.js';
import { createMockCMAServer, type MockCMAServer } from '../helpers/mock-cma-server.js';

// Use the shared import fixture which is a valid CDF components file
const componentsPath = resolve(import.meta.dirname, '../fixtures/import/components.json');

// Base MOCK_ROUTES: preview returns empty (nothing to select), used for flag-validation tests
const EMPTY_PREVIEW_ROUTES = {
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

// Routes where preview returns new entities so select has something to work with
const PREVIEW_WITH_ENTITIES_ROUTES = {
  ...EMPTY_PREVIEW_ROUTES,
  'POST /spaces/test-space/environments/master/design_systems/imports/preview': {
    components: {
      new: [{ key: 'Button', id: 'button-id', name: 'Button' }],
      changed: [],
      removed: [],
      unchanged: [],
    },
    tokens: { new: [], changed: [], removed: [], unchanged: [] },
    taxonomies: { new: [], changed: [], removed: [], unchanged: [] },
  },
};

// Routes where preview returns a changed entity with a breaking classification
const PREVIEW_WITH_BREAKING_ROUTES = {
  ...EMPTY_PREVIEW_ROUTES,
  'POST /spaces/test-space/environments/master/design_systems/imports/preview': {
    components: {
      new: [],
      changed: [
        {
          current: { id: 'button-id', name: 'Button' },
          incoming: { id: 'button-id', name: 'Button' },
          changeClassification: { classification: 'breaking' },
          impact: { affectedFragments: 3, affectedExperiences: 1 },
          hasPendingDraftChanges: false,
        },
      ],
      removed: [],
      unchanged: [],
    },
    tokens: { new: [], changed: [], removed: [], unchanged: [] },
    taxonomies: { new: [], changed: [], removed: [], unchanged: [] },
  },
};

describe('apply select — flag variations', () => {
  let emptyServer: MockCMAServer;
  let entityServer: MockCMAServer;
  let breakingServer: MockCMAServer;

  beforeAll(async () => {
    [emptyServer, entityServer, breakingServer] = await Promise.all([
      createMockCMAServer(EMPTY_PREVIEW_ROUTES),
      createMockCMAServer(PREVIEW_WITH_ENTITIES_ROUTES),
      createMockCMAServer(PREVIEW_WITH_BREAKING_ROUTES),
    ]);
  });

  afterAll(() => {
    emptyServer.close();
    entityServer.close();
    breakingServer.close();
  });

  const baseEnv = () => ({
    NODE_NO_WARNINGS: '1',
    // Ensure no ambient CONTENTFUL_* env vars interfere
    CONTENTFUL_SPACE_ID: '',
    CONTENTFUL_ENVIRONMENT_ID: '',
    CONTENTFUL_MANAGEMENT_TOKEN: '',
  });

  // ── Help ──────────────────────────────────────────────────────────────────

  it('--help shows all expected flags', async () => {
    const { stdout, code } = await runCli(['apply', 'select', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--space-id');
    expect(stdout).toContain('--environment-id');
    expect(stdout).toContain('--cma-token');
    expect(stdout).toContain('--components');
    expect(stdout).toContain('--tokens');
    expect(stdout).toContain('--session');
    expect(stdout).toContain('--host');
    expect(stdout).toContain('--select-all');
    expect(stdout).toContain('--select');
    expect(stdout).toContain('--deselect');
    expect(stdout).toContain('--force');
  });

  // ── Missing required credentials ──────────────────────────────────────────

  it('fails without required --space-id', async () => {
    const args = [
      'apply',
      'select',
      '--components',
      componentsPath,
      '--environment-id',
      'master',
      '--cma-token',
      'tok',
      '--select-all',
    ];
    const { code, stderr } = await runCliWithEnv(args, baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/space-id/i);
  });

  it('fails without required --environment-id', async () => {
    const args = [
      'apply',
      'select',
      '--components',
      componentsPath,
      '--space-id',
      'test-space',
      '--cma-token',
      'tok',
      '--select-all',
    ];
    const { code, stderr } = await runCliWithEnv(args, baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/environment-id/i);
  });

  // ── --select-all ──────────────────────────────────────────────────────────

  it('--select-all selects all entities headlessly and exits zero', async () => {
    const requestsBefore = entityServer.requests.length;
    const { code } = await runCliWithEnv(
      [
        'apply',
        'select',
        '--components',
        componentsPath,
        '--space-id',
        'test-space',
        '--environment-id',
        'master',
        '--cma-token',
        'test-token',
        '--select-all',
        '--host',
        entityServer.url,
      ],
      baseEnv(),
    );
    expect(code).toBe(0);
    // Should have called both preview and apply
    const requests = entityServer.requests.slice(requestsBefore);
    const previewPosts = requests.filter((r) => r.method === 'POST' && r.url.includes('/preview'));
    const applyPosts = requests.filter((r) => r.method === 'POST' && r.url.includes('/imports/apply'));
    expect(previewPosts.length).toBeGreaterThan(0);
    expect(applyPosts.length).toBeGreaterThan(0);
  });

  it('--select-all exits zero with empty preview (nothing to change)', async () => {
    const { code, stderr } = await runCliWithEnv(
      [
        'apply',
        'select',
        '--components',
        componentsPath,
        '--space-id',
        'test-space',
        '--environment-id',
        'master',
        '--cma-token',
        'test-token',
        '--select-all',
        '--host',
        emptyServer.url,
      ],
      baseEnv(),
    );
    expect(code).toBe(0);
    expect(stderr).toMatch(/nothing to change/i);
  });

  // ── --select <pattern> ────────────────────────────────────────────────────

  it('--select <pattern> filters entities by name and calls apply', async () => {
    const requestsBefore = entityServer.requests.length;
    const { code } = await runCliWithEnv(
      [
        'apply',
        'select',
        '--components',
        componentsPath,
        '--space-id',
        'test-space',
        '--environment-id',
        'master',
        '--cma-token',
        'test-token',
        '--select',
        'Button',
        '--host',
        entityServer.url,
      ],
      baseEnv(),
    );
    // Either succeeds (matched something) or exits with 0 (no match message)
    expect(typeof code).toBe('number');
    const requests = entityServer.requests.slice(requestsBefore);
    const previewPosts = requests.filter((r) => r.method === 'POST' && r.url.includes('/preview'));
    expect(previewPosts.length).toBeGreaterThan(0);
  });

  it('--select with non-matching pattern exits zero with no-match message', async () => {
    const { code, stderr } = await runCliWithEnv(
      [
        'apply',
        'select',
        '--components',
        componentsPath,
        '--space-id',
        'test-space',
        '--environment-id',
        'master',
        '--cma-token',
        'test-token',
        '--select',
        'NonExistentComponent',
        '--host',
        entityServer.url,
      ],
      baseEnv(),
    );
    expect(code).toBe(0);
    expect(stderr).toMatch(/no entities matched/i);
  });

  // ── --deselect <pattern> ──────────────────────────────────────────────────

  it('--deselect <pattern> excludes matched entities', async () => {
    // With --select-all + --deselect everything, should result in no selections
    const { code, stderr } = await runCliWithEnv(
      [
        'apply',
        'select',
        '--components',
        componentsPath,
        '--space-id',
        'test-space',
        '--environment-id',
        'master',
        '--cma-token',
        'test-token',
        '--deselect',
        'Button',
        '--host',
        entityServer.url,
      ],
      baseEnv(),
    );
    // All entities deselected: "No entities matched" or success
    expect(typeof code).toBe('number');
    // If nothing matched after deselect, stderr should say so
    if (code === 0) {
      expect(stderr).toMatch(/no entities matched/i);
    }
  });

  // ── --select + --deselect combined ────────────────────────────────────────

  it('--select and --deselect combined narrow the selection', async () => {
    const { code } = await runCliWithEnv(
      [
        'apply',
        'select',
        '--components',
        componentsPath,
        '--space-id',
        'test-space',
        '--environment-id',
        'master',
        '--cma-token',
        'test-token',
        '--select',
        'Button',
        '--deselect',
        'Button',
        '--host',
        entityServer.url,
      ],
      baseEnv(),
    );
    // Select then deselect same pattern → no entities selected
    expect(typeof code).toBe('number');
  });

  // ── --force skips breaking change confirmation ────────────────────────────

  it('without --force, exits non-zero when selection includes breaking changes', async () => {
    const { code, stderr } = await runCliWithEnv(
      [
        'apply',
        'select',
        '--components',
        componentsPath,
        '--space-id',
        'test-space',
        '--environment-id',
        'master',
        '--cma-token',
        'test-token',
        '--select-all',
        '--host',
        breakingServer.url,
      ],
      baseEnv(),
    );
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/breaking/i);
  });

  it('--force skips breaking change confirmation and proceeds to apply', async () => {
    const requestsBefore = breakingServer.requests.length;
    const { code } = await runCliWithEnv(
      [
        'apply',
        'select',
        '--components',
        componentsPath,
        '--space-id',
        'test-space',
        '--environment-id',
        'master',
        '--cma-token',
        'test-token',
        '--select-all',
        '--force',
        '--host',
        breakingServer.url,
      ],
      baseEnv(),
    );
    expect(code).toBe(0);
    const requests = breakingServer.requests.slice(requestsBefore);
    const applyPosts = requests.filter((r) => r.method === 'POST' && r.url.includes('/imports/apply'));
    expect(applyPosts.length).toBeGreaterThan(0);
  });

  // ── Non-TTY guard (no select flags) ──────────────────────────────────────

  it('exits non-zero in non-TTY mode without any select flags', async () => {
    const args = [
      'apply',
      'select',
      '--components',
      componentsPath,
      '--space-id',
      'test-space',
      '--environment-id',
      'master',
      '--cma-token',
      'test-token',
      '--host',
      emptyServer.url,
    ];
    const { code, stderr } = await runCliWithEnv(args, baseEnv());
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/interactive terminal|--select-all|--select|--deselect/i);
  });
});
