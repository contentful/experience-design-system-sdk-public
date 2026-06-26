import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import React from 'react';
import { render } from 'ink-testing-library';
import { runCliWithEnv } from '../helpers/cli-runner.js';
import { createMockCMAServer, type MockCMAServer } from '../helpers/mock-cma-server.js';
import { ServerApplyDone } from '../../src/apply/tui/ServerApplyView.js';

const componentsPath = resolve(import.meta.dirname, '../fixtures/import/components.json');

// Routes where preview returns a non-empty diff so push actually applies.
const NON_EMPTY_ROUTES = {
  'GET /spaces/test-space': {
    sys: { type: 'Space', id: 'test-space', organization: { sys: { id: 'org-123' } } },
  },
  'GET /spaces/test-space/environments/master': {
    sys: { type: 'Environment', id: 'master' },
  },
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
  'POST /spaces/test-space/environments/master/design_systems/imports/apply': {
    sys: { id: 'op-1', status: 'queued' },
  },
  'GET /spaces/test-space/environments/master/design_systems/imports/apply/op-1': {
    sys: { id: 'op-1', status: 'succeeded' },
    items: [
      {
        entityType: 'ComponentType',
        id: 'button-id',
        action: 'create',
        status: 'succeeded',
      },
    ],
    summary: { total: 1, succeeded: 1, failed: 0, pending: 0 },
  },
};

const EMPTY_PREVIEW_ROUTES = {
  ...NON_EMPTY_ROUTES,
  'POST /spaces/test-space/environments/master/design_systems/imports/preview': {
    components: { new: [], changed: [], removed: [], unchanged: [] },
    tokens: { new: [], changed: [], removed: [], unchanged: [] },
    taxonomies: { new: [], changed: [], removed: [], unchanged: [] },
  },
};

const baseEnv = () => ({
  NODE_NO_WARNINGS: '1',
  CONTENTFUL_SPACE_ID: '',
  CONTENTFUL_ENVIRONMENT_ID: '',
  CONTENTFUL_MANAGEMENT_TOKEN: '',
});

describe('apply push / select — viewUrl emission (Gap 4)', () => {
  let pushServer: MockCMAServer;
  let previewServer: MockCMAServer;

  beforeAll(async () => {
    [pushServer, previewServer] = await Promise.all([
      createMockCMAServer(NON_EMPTY_ROUTES),
      createMockCMAServer(EMPTY_PREVIEW_ROUTES),
    ]);
  });

  afterAll(() => {
    pushServer.close();
    previewServer.close();
  });

  it('non-TTY apply push JSON summary includes viewUrl', async () => {
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
      '--yes',
      '--host',
      pushServer.url,
    ];
    const { stdout, code } = await runCliWithEnv(args, baseEnv());
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(typeof payload.viewUrl).toBe('string');
    expect(payload.viewUrl).toMatch(
      /^https:\/\/.+\/spaces\/test-space\/environments\/master\/views\/components$/,
    );
  });

  it('non-TTY apply select JSON summary includes viewUrl', async () => {
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
      '--select-all',
      '--host',
      pushServer.url,
    ];
    const { stdout, code } = await runCliWithEnv(args, baseEnv());
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(typeof payload.viewUrl).toBe('string');
    expect(payload.viewUrl).toMatch(
      /^https:\/\/.+\/spaces\/test-space\/environments\/master\/views\/components$/,
    );
  });

  it('non-TTY apply preview JSON output does NOT include viewUrl', async () => {
    const args = [
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
      previewServer.url,
    ];
    const { stdout, code } = await runCliWithEnv(args, baseEnv());
    expect(code).toBe(0);
    const payload = JSON.parse(stdout);
    expect(payload).not.toHaveProperty('viewUrl');
  });

  it('interactive ServerApplyDone renders the view URL on success', () => {
    const { lastFrame } = render(
      React.createElement(ServerApplyDone, {
        operation: {
          sys: {
            type: 'ApplyOperation' as const,
            id: 'op-1',
            status: 'succeeded' as const,
            createdAt: '2026-01-01T00:00:00Z',
            createdBy: { sys: { type: 'Link' as const, linkType: 'User', id: 'u' } },
          },
          summary: { total: 1, succeeded: 1, failed: 0, pending: 0 },
          items: [],
        },
        spaceId: 'test-space',
        environmentId: 'master',
        host: 'api.contentful.com',
      }),
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain(
      'https://app.contentful.com/spaces/test-space/environments/master/views/components',
    );
  });
});
