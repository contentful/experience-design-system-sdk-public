import { describe, expect, it, vi } from 'vitest';
import { CDF_SCHEMA_URL } from '@contentful/experience-design-system-types';
import { runPush, type PushDeps } from '../../../src/tui/import/steps/10-flow/flow/push.js';
import type { FlowPatch } from '../../../src/tui/import/steps/10-flow/flow/types.js';

const operation = (summary: { total: number; pending: number; succeeded: number; failed: number }) => ({
  sys: { id: 'op-1', status: 'inProgress' },
  summary,
  items: [],
});

// The push carries on after an entity is rejected, and only the end of it says which failed. What must hold is that the
// screen is told how many have failed while it is still going.
describe('the push progress', () => {
  it('reports how many entities have failed so far, while the push is still running', async () => {
    const client = {
      applyImport: vi.fn(async () => operation({ total: 4, pending: 4, succeeded: 0, failed: 0 })),
      pollOperation: vi.fn(async (_id: string, options: { onProgress?: (op: unknown) => void }) => {
        options.onProgress?.(operation({ total: 4, pending: 1, succeeded: 2, failed: 1 }));
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
});
