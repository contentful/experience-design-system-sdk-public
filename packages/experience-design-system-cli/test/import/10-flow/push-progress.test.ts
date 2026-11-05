import { describe, expect, it, vi } from 'vitest';
import { CDF_SCHEMA_URL } from '@contentful/experience-design-system-types';
import { runPush, type PushDeps } from '../../../src/tui/import/steps/10-flow/flow/push.js';
import { activityFromItems } from '../../../src/tui/import/steps/10-flow/support/push-progress.js';
import type { FlowPatch } from '../../../src/tui/import/steps/10-flow/flow/types.js';

const operation = (
  summary: { total: number; pending: number; succeeded: number; failed: number },
  items: unknown[] = [],
) => ({
  sys: { id: 'op-1', status: 'inProgress' },
  summary,
  items,
});

describe('the push activity', () => {
  it('keeps the reason an entity was rejected, whether the API gives it as text or as an object', () => {
    const items = activityFromItems([
      { entityType: 'Component', action: 'create', id: 'A', status: 'failed', error: 'plain reason' },
      { entityType: 'DesignToken', action: 'update', id: 'B', status: 'failed', error: { message: 'object reason' } },
      { entityType: 'DesignToken', action: 'delete', id: 'C', status: 'succeeded' },
    ]);

    expect(items).toEqual([
      { name: 'A', state: 'failed', detail: 'create component', error: 'plain reason' },
      { name: 'B', state: 'failed', detail: 'update token', error: 'object reason' },
      { name: 'C', state: 'done', detail: 'delete token' },
    ]);
  });
});

// The push carries on after an entity is rejected, and only the end of it says which failed. What must hold is that the
// screen is told how many have failed while it is still going.
describe('the push progress', () => {
  it('reports how many entities have failed so far, while the push is still running', async () => {
    const client = {
      applyImport: vi.fn(async () => operation({ total: 4, pending: 4, succeeded: 0, failed: 0 })),
      pollOperation: vi.fn(async (_id: string, options: { onProgress?: (op: unknown) => void }) => {
        options.onProgress?.(
          operation({ total: 4, pending: 1, succeeded: 2, failed: 1 }, [
            { entityType: 'Component', action: 'create', id: 'Button', status: 'succeeded' },
            {
              entityType: 'Component',
              action: 'create',
              id: 'Hero',
              status: 'failed',
              error: { code: 'invalid', message: 'Slot "children" refers to a component that does not exist' },
            },
            { entityType: 'DesignToken', action: 'create', id: 'color.primary', status: 'succeeded' },
            { entityType: 'Component', action: 'create', id: 'Card', status: 'queued' },
          ]),
        );
        return {
          ...operation({ total: 4, pending: 0, succeeded: 3, failed: 1 }),
          sys: { id: 'op-1', status: 'partial' },
        };
      }),
      getLastRequestId: () => undefined,
    };
    const deps: PushDeps = {
      createClient: () => client as never,
      updateRun: vi.fn() as never,
      log: vi.fn(),
      warn: vi.fn(),
      verboseErrors: false,
    };
    const patches: FlowPatch[] = [];

    await runPush(
      {
        state: { credentialsSkipped: false, lastRunId: null },
        cdf: { $schema: CDF_SCHEMA_URL },
        spaceId: 'space',
        environmentId: 'master',
        cmaToken: 'token',
        host: 'api.contentful.com',
        acknowledgeBreakingChanges: false,
      },
      deps,
      (patch) => patches.push(patch),
    );

    expect(patches.map((patch) => patch.pushProgress)).toContainEqual(
      expect.objectContaining({ kind: 'progress', processed: 3, total: 4, failed: 1 }),
    );
  });

  // The panel lists what has happened to each entity, including why one was rejected, and not what is still waiting.
  it('gives the panel each processed entity, with the reason one was rejected, and leaves out those still queued', async () => {
    const client = {
      applyImport: vi.fn(async () => operation({ total: 4, pending: 4, succeeded: 0, failed: 0 })),
      pollOperation: vi.fn(async (_id: string, options: { onProgress?: (op: unknown) => void }) => {
        options.onProgress?.(
          operation({ total: 4, pending: 1, succeeded: 2, failed: 1 }, [
            { entityType: 'Component', action: 'create', id: 'Button', status: 'succeeded' },
            {
              entityType: 'Component',
              action: 'create',
              id: 'Hero',
              status: 'failed',
              error: { code: 'invalid', message: 'Slot "children" refers to a component that does not exist' },
            },
            { entityType: 'Component', action: 'create', id: 'Card', status: 'queued' },
          ]),
        );
        return {
          ...operation({ total: 4, pending: 0, succeeded: 3, failed: 1 }),
          sys: { id: 'op-1', status: 'partial' },
        };
      }),
      getLastRequestId: () => undefined,
    };
    const deps: PushDeps = {
      createClient: () => client as never,
      updateRun: vi.fn() as never,
      log: vi.fn(),
      warn: vi.fn(),
      verboseErrors: false,
    };
    const patches: FlowPatch[] = [];

    await runPush(
      {
        state: { credentialsSkipped: false, lastRunId: null },
        cdf: { $schema: CDF_SCHEMA_URL },
        spaceId: 'space',
        environmentId: 'master',
        cmaToken: 'token',
        host: 'api.contentful.com',
        acknowledgeBreakingChanges: false,
      },
      deps,
      (patch) => patches.push(patch),
    );

    const progress = patches.map((patch) => patch.pushProgress).find((p) => p?.kind === 'progress');
    expect(progress).toMatchObject({
      items: [
        { name: 'Button', state: 'done', detail: 'create component' },
        {
          name: 'Hero',
          state: 'failed',
          error: 'Slot "children" refers to a component that does not exist',
        },
      ],
    });
  });
});
