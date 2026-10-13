import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@contentful/experience-design-system-backend-pipeline';
import type {
  ApplyOperationResponse,
  CDFDocument,
  ServerPreviewResponse,
} from '@contentful/experience-design-system-types';
import { runPush, type PushDeps, type RunPushInput } from '../../../src/tui/import/steps/10-flow/flow/push.js';
import type { FlowPatch } from '../../../src/tui/import/steps/10-flow/flow/types.js';

const component = (allowed: string[] = []) => ({
  $type: 'component',
  $properties: {},
  $slots: { content: { $allowedComponents: allowed } },
});
const cdfOf = (components: Record<string, unknown>): CDFDocument =>
  ({ $schema: 'https://contentful.com/schemas/cdf', ...components }) as unknown as CDFDocument;
const goodCdf = () => cdfOf({ Button: component(), Card: component() });

const previewWith = (
  overrides: Partial<ServerPreviewResponse['components']> = {},
  tokens: Partial<ServerPreviewResponse['tokens']> = {},
): ServerPreviewResponse => ({
  components: { new: [], changed: [], removed: [], unchanged: [], ...overrides },
  tokens: { new: [], changed: [], removed: [], unchanged: [], ...tokens },
  taxonomies: { new: [], changed: [], removed: [], unchanged: [] },
});

const operation = (
  status: ApplyOperationResponse['sys']['status'],
  summary: Partial<ApplyOperationResponse['summary']> = {},
  items?: ApplyOperationResponse['items'],
): ApplyOperationResponse =>
  ({
    sys: {
      type: 'ApplyOperation',
      id: 'op-1',
      status,
      createdAt: 'now',
      createdBy: { sys: { type: 'Link', linkType: 'User', id: 'u' } },
    },
    summary: { total: 0, pending: 0, succeeded: 0, failed: 0, ...summary },
    ...(items ? { items } : {}),
  }) as ApplyOperationResponse;

const item = (entityType: string, action: string, status: string, id = 'x', error?: unknown) =>
  ({ entityType, action, status, id, ...(error === undefined ? {} : { error }) }) as never;

describe('runPush', () => {
  const applyImport = vi.fn();
  const pollOperation = vi.fn();
  const createClient = vi.fn();
  const updateRun = vi.fn();
  const log = vi.fn();
  const warn = vi.fn();
  const patches: FlowPatch[] = [];

  const deps = (overrides: Partial<PushDeps> = {}): PushDeps => ({
    createClient,
    updateRun,
    log,
    warn,
    verboseErrors: false,
    ...overrides,
  });
  const input = (overrides: Partial<RunPushInput> = {}): RunPushInput => ({
    state: { credentialsSkipped: false, lastRunId: 'run-1' },
    cdf: goodCdf(),
    spaceId: 'space1',
    environmentId: 'master',
    cmaToken: 'token',
    host: 'https://api.contentful.com',
    acknowledgeBreakingChanges: false,
    preview: previewWith({ new: [{} as never, {} as never] }),
    ...overrides,
  });
  const run = (i: RunPushInput = input(), d: PushDeps = deps()) => runPush(i, d, (patch) => patches.push(patch));
  const apiError = (status: number, body: unknown) =>
    new ApiError(`apply failed: ${status}`, status, typeof body === 'string' ? body : JSON.stringify(body));

  beforeEach(() => {
    patches.length = 0;
    applyImport.mockReset().mockResolvedValue(operation('queued'));
    pollOperation.mockReset().mockResolvedValue(operation('succeeded', { total: 2, succeeded: 2 }));
    createClient.mockReset().mockReturnValue({ applyImport, pollOperation });
    updateRun.mockReset().mockResolvedValue({});
    log.mockReset();
    warn.mockReset();
  });

  describe('when it refuses to push', () => {
    it('goes to the print gate, without building a client, when credentials were skipped', async () => {
      const patch = await run(input({ state: { credentialsSkipped: true, lastRunId: null } }));

      expect(patch).toEqual({ step: 'print-gate' });
      expect(createClient).not.toHaveBeenCalled();
    });

    it('is done with nothing pushed when the preview has no changes, without applying anything', async () => {
      const patch = await run(input({ preview: previewWith() }));

      expect(patch).toEqual({
        step: 'done',
        pushResult: {
          componentTypes: { created: 0, updated: 0, removed: 0, failed: 0 },
          designTokens: { created: 0, updated: 0, removed: 0, failed: 0 },
        },
      });
      expect(applyImport).not.toHaveBeenCalled();
    });

    it.each([
      ['new components', { new: [{} as never] }, {}],
      ['changed components', { changed: [{} as never] }, {}],
      ['removed components', { removed: [{} as never] }, {}],
      ['new tokens', {}, { new: [{} as never] }],
      ['changed tokens', {}, { changed: [{} as never] }],
      ['removed tokens', {}, { removed: [{} as never] }],
    ])('goes ahead when the preview has %s', async (_label, components, tokens) => {
      await run(input({ preview: previewWith(components, tokens) }));

      expect(applyImport).toHaveBeenCalledTimes(1);
    });

    it('goes ahead when there is no preview to check against', async () => {
      await run(input({ preview: null }));

      expect(applyImport).toHaveBeenCalledTimes(1);
    });

    it('stops with the cycle report when the accepted components depend on each other in a loop', async () => {
      const cdf = cdfOf({ A: component(['B']), B: component(['A']) });

      const patch = await run(input({ cdf }));

      expect(patch).toMatchObject({ step: 'error', errorStep: 'apply', errorAllowCredentialRetry: false });
      expect((patch as { errorMessage: string }).errorMessage).toContain('slot dependency cycle');
      expect(applyImport).not.toHaveBeenCalled();
    });

    it('stops with the unresolved references when a slot allows a component that is not there', async () => {
      const cdf = cdfOf({ A: component(['Missing']) });

      const patch = await run(input({ cdf }));

      expect(patch).toMatchObject({ step: 'error', errorStep: 'apply', errorAllowCredentialRetry: false });
      expect((patch as { errorMessage: string }).errorMessage).toContain('failed to resolve locally. Push refused.');
      expect(applyImport).not.toHaveBeenCalled();
    });

    it('checks for a cycle before it checks for unresolved references', async () => {
      const cdf = cdfOf({ A: component(['B', 'Missing']), B: component(['A']) });

      expect(((await run(input({ cdf }))) as { errorMessage: string }).errorMessage).toContain('slot dependency cycle');
    });
  });

  describe('a successful push', () => {
    it('starts by showing the push has begun, with no progress yet and the acknowledgement prompt cleared', async () => {
      await run();

      expect(patches[0]).toEqual({
        step: 'pushing',
        pushProgress: null,
        errorAllowBreakingChangeAcknowledgment: false,
      });
    });

    it('builds the client from the credentials, and applies the document as given', async () => {
      const cdf = goodCdf();

      await run(input({ cdf, spaceId: 's', environmentId: 'e', cmaToken: 't', host: 'https://h' }));

      expect(createClient).toHaveBeenCalledWith({ cmaToken: 't', spaceId: 's', environmentId: 'e', host: 'https://h' });
      expect(applyImport).toHaveBeenCalledWith(cdf, { acknowledgeBreakingChanges: false });
    });

    it('passes the breaking change acknowledgement on', async () => {
      await run(input({ acknowledgeBreakingChanges: true }));

      expect(applyImport).toHaveBeenCalledWith(expect.anything(), { acknowledgeBreakingChanges: true });
    });

    it('shows the operation as queued once the server accepted it, then polls that operation', async () => {
      applyImport.mockResolvedValue({ ...operation('queued'), sys: { ...operation('queued').sys, id: 'op-42' } });

      await run();

      expect(patches[1]).toEqual({ pushProgress: { kind: 'queued', operationId: 'op-42' } });
      expect(pollOperation).toHaveBeenCalledWith('op-42', expect.any(Object));
    });

    it('reports how far along the operation is while it polls, naming the last thing that finished', async () => {
      pollOperation.mockImplementation(async (_id, options) => {
        options.onProgress(
          operation('running', { total: 10, pending: 6 }, [item('ComponentType', 'create', 'succeeded', 'Button')]),
        );
        return operation('succeeded', { total: 10, succeeded: 10 });
      });

      await run();

      expect(patches).toContainEqual({
        pushProgress: { kind: 'progress', processed: 4, total: 10, current: 'Button' },
      });
    });

    it('names nothing as current when the last item has not succeeded yet', async () => {
      pollOperation.mockImplementation(async (_id, options) => {
        options.onProgress(
          operation('running', { total: 3, pending: 2 }, [item('ComponentType', 'create', 'pending', 'Card')]),
        );
        return operation('succeeded');
      });

      await run();

      expect(patches).toContainEqual({ pushProgress: { kind: 'progress', processed: 1, total: 3, current: null } });
    });

    it('names nothing as current when there are no items', async () => {
      pollOperation.mockImplementation(async (_id, options) => {
        options.onProgress(operation('running', { total: 3, pending: 3 }));
        return operation('succeeded');
      });

      await run();

      expect(patches).toContainEqual({ pushProgress: { kind: 'progress', processed: 0, total: 3, current: null } });
    });

    it('counts what was created, updated and removed from the items, separately for components and tokens', async () => {
      // Different numbers for every action, so counting one action as another cannot give the same totals.
      const many = (n: number, entityType: string, action: string) =>
        Array.from({ length: n }, (_, i) => item(entityType, action, 'succeeded', `${entityType}-${action}-${i}`));
      pollOperation.mockResolvedValue(
        operation('succeeded', { total: 21, succeeded: 21 }, [
          ...many(1, 'ComponentType', 'create'),
          ...many(2, 'ComponentType', 'update'),
          ...many(3, 'ComponentType', 'delete'),
          ...many(4, 'DesignToken', 'create'),
          ...many(5, 'DesignToken', 'update'),
          ...many(6, 'DesignToken', 'delete'),
        ]),
      );

      const patch = (await run()) as { step: string; pushResult: { componentTypes: object; designTokens: object } };

      expect(patch.step).toBe('done');
      expect(patch.pushResult.componentTypes).toEqual({ created: 1, updated: 2, removed: 3, failed: 0 });
      expect(patch.pushResult.designTokens).toEqual({ created: 4, updated: 5, removed: 6, failed: 0 });
    });

    it('includes the summary the server gave', async () => {
      const summary = { total: 1, pending: 0, succeeded: 1, failed: 0 };
      pollOperation.mockResolvedValue(operation('succeeded', summary, [item('ComponentType', 'create', 'succeeded')]));

      expect(((await run()) as { pushResult: { summary: unknown } }).pushResult.summary).toEqual(summary);
    });

    it('lists the items that failed, with the reason formatted for people', async () => {
      pollOperation.mockResolvedValue(
        operation('partial', { total: 2, succeeded: 1, failed: 1 }, [
          item('ComponentType', 'create', 'succeeded', 'Button'),
          item('ComponentType', 'create', 'failed', 'Card', { message: 'Validation error' }),
        ]),
      );

      const patch = (await run()) as {
        pushResult: {
          componentTypes: { failed: number };
          failures: Array<{ entityType: string; entityId: string; message: string }>;
        };
      };

      expect(patch.pushResult.componentTypes.failed).toBe(1);
      expect(patch.pushResult.failures).toHaveLength(1);
      expect(patch.pushResult.failures[0]).toMatchObject({ entityType: 'ComponentType', entityId: 'Card' });
      expect(patch.pushResult.failures[0].message).toContain('Validation error');
    });

    it('counts a failed token separately from a failed component', async () => {
      pollOperation.mockResolvedValue(
        operation('partial', { total: 2, succeeded: 1, failed: 1 }, [
          item('ComponentType', 'create', 'succeeded'),
          item('DesignToken', 'create', 'failed', 't', 'bad'),
        ]),
      );

      const patch = (await run()) as {
        pushResult: { componentTypes: { failed: number }; designTokens: { failed: number } };
      };

      expect(patch.pushResult.componentTypes.failed).toBe(0);
      expect(patch.pushResult.designTokens.failed).toBe(1);
    });
  });

  describe('when the operation reports no items', () => {
    it('counts what the preview said would happen, when the operation succeeded', async () => {
      pollOperation.mockResolvedValue(operation('succeeded', { total: 5, succeeded: 5 }));
      const preview = previewWith(
        { new: [{}, {}] as never[], changed: [{}] as never[], removed: [{}] as never[] },
        { new: [{}] as never[], changed: [{}, {}] as never[], removed: [{}] as never[] },
      );

      const patch = (await run(input({ preview }))) as { pushResult: { componentTypes: object; designTokens: object } };

      expect(patch.pushResult.componentTypes).toEqual({ created: 2, updated: 1, removed: 1, failed: 0 });
      expect(patch.pushResult.designTokens).toEqual({ created: 1, updated: 2, removed: 1, failed: 0 });
    });

    it.each(['failed', 'partial'] as const)(
      'counts nothing as done when the operation is %s, and reports the failures',
      async (status) => {
        pollOperation.mockResolvedValue(operation(status, { total: 3, succeeded: 1, failed: 2 }));

        const patch = (await run(input({ preview: previewWith({ new: [{}, {}] as never[] }) }))) as {
          pushResult: { componentTypes: { created: number; failed: number } };
        };

        expect(patch.pushResult.componentTypes).toMatchObject({ created: 0, failed: 2 });
      },
    );

    it('counts nothing as done when the summary has failures, even if the operation says it succeeded', async () => {
      pollOperation.mockResolvedValue(operation('succeeded', { total: 2, succeeded: 1, failed: 1 }));

      const patch = (await run(input({ preview: previewWith({ new: [{}, {}] as never[] }) }))) as {
        pushResult: { componentTypes: { created: number } };
      };

      expect(patch.pushResult.componentTypes.created).toBe(0);
    });

    it('counts zero for everything without a preview to go on', async () => {
      pollOperation.mockResolvedValue(operation('succeeded'));

      const patch = (await run(input({ preview: null }))) as { pushResult: { componentTypes: object } };

      expect(patch.pushResult.componentTypes).toEqual({ created: 0, updated: 0, removed: 0, failed: 0 });
    });
  });

  describe('recording where the run was pushed', () => {
    it('records the target on the run when everything succeeded', async () => {
      await run(input({ spaceId: 's', environmentId: 'e', host: 'https://h' }));

      expect(updateRun).toHaveBeenCalledWith('run-1', {
        pushedTo: { spaceId: 's', environmentId: 'e', host: 'https://h' },
      });
    });

    it('records nothing when something failed', async () => {
      pollOperation.mockResolvedValue(
        operation('partial', { total: 1, failed: 1 }, [item('ComponentType', 'create', 'failed')]),
      );

      await run();

      expect(updateRun).not.toHaveBeenCalled();
    });

    it('records nothing when the operation itself failed', async () => {
      pollOperation.mockResolvedValue(
        operation('failed', { total: 1, succeeded: 1 }, [item('ComponentType', 'create', 'succeeded')]),
      );

      await run();

      expect(updateRun).not.toHaveBeenCalled();
    });

    it('records nothing when there is no run to record on', async () => {
      await run(input({ state: { credentialsSkipped: false, lastRunId: null } }));

      expect(updateRun).not.toHaveBeenCalled();
    });

    it('warns, and still finishes, when recording fails', async () => {
      updateRun.mockRejectedValue(new Error('disk full'));

      const patch = await run();

      expect(patch).toMatchObject({ step: 'done' });
      expect(warn).toHaveBeenCalledWith('Warning: failed to record push target on run: disk full\n');
    });
  });

  describe('when the push fails', () => {
    it('shows an API error formatted for people, and offers to re-enter credentials', async () => {
      applyImport.mockRejectedValue(apiError(500, { message: 'boom' }));

      const patch = (await run()) as FlowPatch & { errorMessage: string };

      expect(patch).toMatchObject({
        step: 'error',
        errorStep: 'apply',
        errorAllowCredentialRetry: true,
        errorAllowBreakingChangeAcknowledgment: false,
      });
      expect(patch.errorMessage).toContain('boom');
    });

    it('offers to acknowledge breaking changes, and not to re-enter credentials, for a 422 that asks for it', async () => {
      applyImport.mockRejectedValue(apiError(422, { message: 'acknowledgeBreakingChanges must be true' }));

      expect(await run()).toMatchObject({
        step: 'error',
        errorAllowCredentialRetry: false,
        errorAllowBreakingChangeAcknowledgment: true,
      });
    });

    it('does not offer that for a 422 that is about something else', async () => {
      applyImport.mockRejectedValue(apiError(422, { message: 'invalid component' }));

      expect(await run()).toMatchObject({
        errorAllowCredentialRetry: true,
        errorAllowBreakingChangeAcknowledgment: false,
      });
    });

    it('does not offer that for a different status that mentions it', async () => {
      applyImport.mockRejectedValue(apiError(400, { message: 'acknowledgeBreakingChanges' }));

      expect(await run()).toMatchObject({
        errorAllowCredentialRetry: true,
        errorAllowBreakingChangeAcknowledgment: false,
      });
    });

    it('a failure while polling is reported the same way', async () => {
      pollOperation.mockRejectedValue(apiError(502, { message: 'bad gateway' }));

      expect(await run()).toMatchObject({ step: 'error', errorStep: 'apply' });
    });

    it('an ordinary error shows its message', async () => {
      applyImport.mockRejectedValue(new Error('socket hang up'));

      expect(await run()).toMatchObject({ errorMessage: 'socket hang up', errorAllowCredentialRetry: true });
    });

    it('something thrown that is not an error gets a generic message', async () => {
      applyImport.mockRejectedValue('nope');

      expect(await run()).toMatchObject({ errorMessage: 'Push failed' });
    });

    it('records nothing about the run when the push failed', async () => {
      applyImport.mockRejectedValue(new Error('x'));

      await run();

      expect(updateRun).not.toHaveBeenCalled();
    });

    it('formats API errors more fully when verbose errors are on', async () => {
      applyImport.mockRejectedValue(apiError(500, { message: 'boom', details: { extra: 'a-distinctive-detail' } }));

      const plain = (await run(input(), deps({ verboseErrors: false }))) as { errorMessage: string };
      const verbose = (await run(input(), deps({ verboseErrors: true }))) as { errorMessage: string };

      expect(verbose.errorMessage).toContain('a-distinctive-detail');
      expect(plain.errorMessage).not.toContain('a-distinctive-detail');
    });
  });

  describe('the step log', () => {
    it('logs the apply response and each poll', async () => {
      pollOperation.mockImplementation(async (_id, options) => {
        options.onProgress(operation('running', { total: 2, pending: 1 }));
        return operation('succeeded');
      });

      await run();

      const keys = log.mock.calls.map(([entry]) => Object.keys(entry)[0]);
      expect(keys).toEqual(['applyResponse', 'pollTick', 'pollResult']);
    });

    it('keeps pushing when a log write fails, and says so on stderr', async () => {
      log.mockImplementation(() => {
        throw new Error('no space left');
      });

      const patch = await run();

      expect(patch).toMatchObject({ step: 'done' });
      expect(warn).toHaveBeenCalledWith('[eds] log write failed: no space left\n');
    });
  });
});
