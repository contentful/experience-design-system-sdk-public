import {
  ApiError,
  detectSlotCycles,
  formatApiError,
  formatEdsiError,
  formatSlotCycleReport,
  formatUnresolvedSlotReferences,
  ImportApiClient,
  updateRun,
} from '@contentful/experience-design-system-backend-pipeline';
import {
  parseCDFComponents,
  validateSlotReferences,
  type ApplyOperationResponse,
  type CDFDocument,
  type ServerPreviewResponse,
} from '@contentful/experience-design-system-types';
import { cliUserAgent } from '../../../../user-agent.js';
import { buildSkippedPushTransition, shouldRefusePush } from '../support/wizard-state-transitions.js';
import type { FlowPatch, FlowState, PushResult } from './types.js';

type PushClient = {
  applyImport(cdf: CDFDocument, options: { acknowledgeBreakingChanges: boolean }): Promise<ApplyOperationResponse>;
  pollOperation(
    operationId: string,
    options: { onProgress?: (operation: ApplyOperationResponse) => void },
  ): Promise<ApplyOperationResponse>;
};

/** The outside world `runPush` talks to, so each branch can be tested without a network or a run history. */
export interface PushDeps {
  createClient: (options: { cmaToken: string; spaceId: string; environmentId: string; host: string }) => PushClient;
  updateRun: typeof updateRun;
  /** Where the wizard's step log goes. A log that cannot be written is reported on stderr and never stops the push. */
  log: (entry: Record<string, unknown>) => void;
  warn: (message: string) => void;
  verboseErrors: boolean;
}

export const realPushDeps = (log: PushDeps['log']): PushDeps => ({
  createClient: (options) => new ImportApiClient({ ...options, userAgent: cliUserAgent() }),
  updateRun,
  log,
  warn: (message) => process.stderr.write(message),
  verboseErrors: process.env['EDSI_VERBOSE_ERRORS'] === '1',
});

export interface RunPushInput {
  state: Pick<FlowState, 'credentialsSkipped' | 'lastRunId'>;
  cdf: CDFDocument;
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host: string;
  acknowledgeBreakingChanges: boolean;
  preview?: ServerPreviewResponse | null;
}

const zeroResult = (): PushResult => ({
  componentTypes: { created: 0, updated: 0, removed: 0, failed: 0 },
  designTokens: { created: 0, updated: 0, removed: 0, failed: 0 },
});

const componentsOf = (cdf: CDFDocument) => parseCDFComponents(cdf as unknown as Record<string, unknown>).components;

/**
 * Pushes the previewed document: the checks that refuse a push that cannot work, then the apply, polling its progress,
 * and the result as the counts the done screen shows. `onPatch` receives the progress while it polls; the returned patch
 * is where the flow ends up.
 */
export async function runPush(
  input: RunPushInput,
  deps: PushDeps,
  onPatch: (patch: FlowPatch) => void,
): Promise<FlowPatch> {
  if (shouldRefusePush(input.state)) return buildSkippedPushTransition();

  const { preview } = input;
  if (preview) {
    const hasComponentChanges =
      preview.components.new.length > 0 ||
      preview.components.changed.length > 0 ||
      preview.components.removed.length > 0;
    const hasTokenChanges =
      preview.tokens.new.length > 0 || preview.tokens.changed.length > 0 || preview.tokens.removed.length > 0;
    if (!hasComponentChanges && !hasTokenChanges) return { step: 'done', pushResult: zeroResult() };
  }

  const cycles = detectSlotCycles({ components: componentsOf(input.cdf) });
  if (cycles.length > 0) {
    return {
      step: 'error',
      errorStep: 'apply',
      errorMessage: formatSlotCycleReport({ cycles }).join('\n'),
      errorAllowCredentialRetry: false,
    };
  }

  const unresolvedSlotReferences = validateSlotReferences(componentsOf(input.cdf));
  if (unresolvedSlotReferences.length > 0) {
    return {
      step: 'error',
      errorStep: 'apply',
      errorMessage: formatUnresolvedSlotReferences({ errors: unresolvedSlotReferences }).join('\n'),
      errorAllowCredentialRetry: false,
    };
  }

  onPatch({ step: 'pushing', pushProgress: null, errorAllowBreakingChangeAcknowledgment: false });
  try {
    const client = deps.createClient({
      cmaToken: input.cmaToken,
      spaceId: input.spaceId,
      environmentId: input.environmentId,
      host: input.host,
    });
    let operation = await client.applyImport(input.cdf, {
      acknowledgeBreakingChanges: input.acknowledgeBreakingChanges,
    });
    safeLog(deps, {
      applyResponse: { status: operation.sys.status, id: operation.sys.id, keys: Object.keys(operation) },
    });
    onPatch({ pushProgress: { kind: 'queued', operationId: operation.sys.id } });

    let pollCount = 0;
    operation = await client.pollOperation(operation.sys.id, {
      onProgress: (op) => {
        pollCount++;
        const summary = op.summary;
        if (summary) {
          const done = summary.total - summary.pending;
          const items = op.items ?? [];
          const lastDone = items.length > 0 ? items[items.length - 1] : null;
          const current = lastDone && lastDone.status === 'succeeded' ? lastDone.id : null;
          onPatch({ pushProgress: { kind: 'progress', processed: done, total: summary.total, current } });
        }
        safeLog(deps, { pollTick: { attempt: pollCount, status: op.sys.status, summary: op.summary } });
      },
    });
    // The wizard logged a failure to write this entry with another write, which fails the same way when the log is
    // unwritable and then failed the push. A log is only a diagnostic, so both go through safeLog.
    try {
      deps.log({
        pollResult: {
          status: operation.sys.status,
          keys: Object.keys(operation),
          itemCount: operation.items?.length,
          summary: operation.summary,
          sampleItems: operation.items?.slice(0, 3),
        },
      });
    } catch (logErr) {
      safeLog(deps, { pollLogError: String(logErr) });
    }

    const pushResult = resultOf(operation, preview);
    const pushSucceeded =
      pushResult.componentTypes.failed === 0 &&
      pushResult.designTokens.failed === 0 &&
      operation.sys.status !== 'failed';
    if (pushSucceeded && input.state.lastRunId) {
      try {
        await deps.updateRun(input.state.lastRunId, {
          pushedTo: { spaceId: input.spaceId, environmentId: input.environmentId, host: input.host },
        });
      } catch (err) {
        deps.warn(
          `Warning: failed to record push target on run: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
    return { step: 'done', pushResult };
  } catch (e) {
    return pushFailure(e, deps);
  }
}

/** Writes to the step log, and says so on stderr instead of stopping the push when it cannot. */
function safeLog(deps: PushDeps, entry: Record<string, unknown>): void {
  try {
    deps.log(entry);
  } catch (err) {
    deps.warn(`[eds] log write failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}

function resultOf(operation: ApplyOperationResponse, preview: ServerPreviewResponse | null | undefined): PushResult {
  const items = operation.items ?? [];
  if (items.length > 0) {
    const count = (entityType: string, action: string) =>
      items.filter((i) => i.entityType === entityType && i.action === action && i.status === 'succeeded').length;
    const failed = (entityType: string) =>
      items.filter((i) => i.entityType === entityType && i.status === 'failed').length;
    return {
      componentTypes: {
        created: count('ComponentType', 'create'),
        updated: count('ComponentType', 'update'),
        removed: count('ComponentType', 'delete'),
        failed: failed('ComponentType'),
      },
      designTokens: {
        created: count('DesignToken', 'create'),
        updated: count('DesignToken', 'update'),
        removed: count('DesignToken', 'delete'),
        failed: failed('DesignToken'),
      },
      summary: operation.summary,
      failures: items
        .filter((item) => item.status === 'failed')
        .map((item) => ({
          entityType: item.entityType,
          entityId: item.id,
          message: formatEdsiError({ raw: item.error }),
        })),
    };
  }
  // No per-item results: fall back to what the preview said would happen, unless the operation says something failed.
  const summary = operation.summary;
  const anyFailure = summary.failed > 0 || operation.sys.status === 'failed' || operation.sys.status === 'partial';
  return {
    componentTypes: {
      created: anyFailure ? 0 : (preview?.components.new.length ?? 0),
      updated: anyFailure ? 0 : (preview?.components.changed.length ?? 0),
      removed: anyFailure ? 0 : (preview?.components.removed.length ?? 0),
      failed: summary.failed,
    },
    designTokens: {
      created: anyFailure ? 0 : (preview?.tokens.new.length ?? 0),
      updated: anyFailure ? 0 : (preview?.tokens.changed.length ?? 0),
      removed: anyFailure ? 0 : (preview?.tokens.removed.length ?? 0),
      failed: 0,
    },
    summary,
  };
}

function pushFailure(e: unknown, deps: PushDeps): FlowPatch {
  let message: string;
  if (e instanceof ApiError) message = formatApiError({ error: e, verbose: deps.verboseErrors });
  else if (e instanceof Error) message = e.message;
  else message = 'Push failed';

  const needsAcknowledgement =
    e instanceof ApiError && e.status === 422 && /acknowledgeBreakingChanges/i.test(e.body || e.message);
  return {
    step: 'error',
    errorStep: 'apply',
    errorMessage: message,
    errorAllowCredentialRetry: !needsAcknowledgement,
    errorAllowBreakingChangeAcknowledgment: needsAcknowledgement,
  };
}
