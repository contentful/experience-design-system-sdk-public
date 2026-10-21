import type { DatabaseSync } from 'node:sqlite';
import {
  ApiError,
  ImportApiClient,
  formatApiError,
  isEmptyPreview,
  loadSelectedCDFComponents,
  openPipelineDb,
  parsePreviewValidationErrors,
  patchReviewStateWithValidationErrors,
  readTokensFromPath,
  recordContentfulContext,
  seedDefaultsFromChangedItems,
  setCommandContext,
  toCDFTokens,
  type PreviewValidationError,
} from '@contentful/experience-design-system-backend-pipeline';
import {
  buildCDF,
  type CDFComponentEntry,
  type CDFDocument,
  type DTCGTokenEntry,
  type ServerPreviewResponse,
} from '@contentful/experience-design-system-types';
import { cliUserAgent } from '../../../../user-agent.js';
import { buildSkippedPreviewTransition, shouldBypassPreview } from '../support/wizard-state-transitions.js';
import type { FlowPatch, FlowState } from './types.js';

type PreviewClient = {
  previewImport(cdf: CDFDocument): Promise<ServerPreviewResponse>;
  /** Request id of the most recent response, used by `recordContentfulContext` for analytics correlation. */
  getLastRequestId(): string | undefined;
};
type ComponentRow = { key: string; entry: CDFComponentEntry };

/** The outside world `runPreview` talks to, so each branch can be tested without a database or a network. */
export interface PreviewDeps {
  createClient: (options: { cmaToken: string; spaceId: string; environmentId: string; host: string }) => PreviewClient;
  openDb: () => DatabaseSync;
  readTokens: (path: string) => Promise<DTCGTokenEntry[]>;
  patchReviewState: typeof patchReviewStateWithValidationErrors;
  verboseErrors: boolean;
}

export const realPreviewDeps = (): PreviewDeps => ({
  createClient: (options) => new ImportApiClient({ ...options, userAgent: cliUserAgent() }),
  openDb: openPipelineDb,
  readTokens: (path) => readTokensFromPath({ flag: 'tokens', path }),
  patchReviewState: patchReviewStateWithValidationErrors,
  verboseErrors: process.env['EDSI_VERBOSE_ERRORS'] === '1',
});

export interface RunPreviewInput {
  state: Pick<FlowState, 'credentialsSkipped'>;
  extractSessionId: string | null;
  tokensPath: string;
  spaceId: string;
  environmentId: string;
  cmaToken: string;
  host: string;
  /** Set when nothing was accepted, so the document is present but empty and the server shows what would be deleted. */
  deleteAll: boolean;
}

/** What to do with a 422 from the preview: show the components that failed, or fall through to the generic error. */
type Preview422Outcome =
  | { kind: 'validation-error'; errors: PreviewValidationError[]; missingNames: string[] }
  | { kind: 'unparseable'; message: string }
  | { kind: 'not-422' };

async function handlePreview422(
  err: ApiError,
  extractSessionId: string | null,
  patchFn: PreviewDeps['patchReviewState'],
): Promise<Preview422Outcome> {
  if (err.status !== 422) return { kind: 'not-422' };
  const errors = parsePreviewValidationErrors(err.body);
  if (errors.length === 0) return { kind: 'unparseable', message: err.message };

  let missingNames: string[] = [];
  if (extractSessionId) {
    const result = await patchFn(extractSessionId, errors);
    missingNames = result.missingNames;
  }
  return { kind: 'validation-error', errors, missingNames };
}

/** The patch to spread into any update that leaves the validation error step, so stale errors do not linger. */
function clearedValidationErrorState(): Pick<FlowState, 'previewValidationErrors' | 'previewValidationMissingNames'> {
  return { previewValidationErrors: [], previewValidationMissingNames: [] };
}

/**
 * Loads what would be pushed and asks the server what that would change. Returns the patch the wizard applied: the
 * preview gate, a terminal "done" when nothing would change, the validation error step for a 422, or an error.
 *
 * It also repairs two things the server's answer can reveal: components it says would be removed that are in fact local
 * (the review dropped their CDF), and defaults it would change. Both are re-seeded from the response, and the preview is
 * taken again.
 */
export async function runPreview(input: RunPreviewInput, deps: PreviewDeps): Promise<FlowPatch> {
  if (shouldBypassPreview(input.state)) return buildSkippedPreviewTransition();

  // Mirror legacy's `apply/command.ts` bindAnalyticsSessionId call, but without rebinding the session id — the
  // extract orchestrator already set it, so we only need to merge the Contentful target into the pending command's
  // context so a failed preview still carries space/env in the failure event.
  setCommandContext({ space_key: input.spaceId, environment_key: input.environmentId });

  try {
    const client = deps.createClient({
      cmaToken: input.cmaToken,
      spaceId: input.spaceId,
      environmentId: input.environmentId,
      host: input.host,
    });

    let components: ComponentRow[] = [];
    if (input.extractSessionId) {
      const db = deps.openDb();
      try {
        components = loadSelectedCDFComponents(db, input.extractSessionId);
      } finally {
        db.close();
      }
    }
    let tokens: DTCGTokenEntry[] = [];
    if (input.tokensPath) tokens = await deps.readTokens(input.tokensPath);

    let cdf = buildCDF(components, toCDFTokens(tokens), { deleteAll: input.deleteAll })!;
    let preview = await client.previewImport(cdf);

    if (input.extractSessionId) {
      let needsRepreview = false;
      const db = deps.openDb();
      try {
        if (preview.components.changed.length > 0) {
          const seededDefaults = seedDefaultsFromChangedItems(db, input.extractSessionId, preview.components.changed);
          if (seededDefaults > 0) needsRepreview = true;
        }

        if (needsRepreview) {
          components = loadSelectedCDFComponents(db, input.extractSessionId);
          cdf = buildCDF(components, toCDFTokens(tokens), { deleteAll: input.deleteAll })!;
          preview = await client.previewImport(cdf);
        }
      } finally {
        db.close();
      }
    }

    // Mirror legacy's `apply/command.ts` recordContentfulContext call: tags the active analytics command with the
    // Contentful target and the preview request id. If a re-preview happened above, this captures the latest id.
    recordContentfulContext(client, input.spaceId, input.environmentId);

    if (isEmptyPreview(preview)) {
      // No-op push: the accepted set already matches the target space, so there is nothing to create, update or remove.
      // Route to a terminal "done" state rather than back to the review, which resets every component to needs-review on
      // remount and would trap the operator in an accept → empty preview → reset loop.
      return {
        step: 'done',
        serverPreview: preview,
        pushResult: {
          componentTypes: { created: 0, updated: 0, removed: 0, failed: 0 },
          designTokens: { created: 0, updated: 0, removed: 0, failed: 0 },
        },
        ...clearedValidationErrorState(),
      };
    }
    return {
      step: 'preview-gate',
      serverPreview: preview,
      cdf,
      finalizeErrorBanner: null,
      ...clearedValidationErrorState(),
    };
  } catch (e) {
    return previewFailure(e, input, deps);
  }
}

async function previewFailure(e: unknown, input: RunPreviewInput, deps: PreviewDeps): Promise<FlowPatch> {
  if (e instanceof ApiError) {
    if (e.status === 401 || e.status === 403) {
      let bodyMsg = '';
      try {
        bodyMsg = (JSON.parse(e.body) as Record<string, unknown>)['message'] as string;
      } catch {
        /* non-JSON */
      }
      if (bodyMsg && /disabled/i.test(bodyMsg)) {
        return {
          step: 'error',
          errorStep: 'apply preview',
          errorMessage: `Preview failed: ${bodyMsg}`,
          errorAllowCredentialRetry: false,
        };
      }
      return {
        step: 'error',
        errorStep: 'apply preview',
        errorMessage: `${e.message}\n\nRe-run the import and enter credentials again.`,
      };
    }
    if (e.status === 404) {
      return {
        step: 'error',
        errorStep: 'apply preview',
        errorAllowCredentialRetry: true,
        errorMessage:
          `Not found (404). Check that the space ID, environment ID, and host are correct.\n\n` +
          `  Space:       ${input.spaceId}\n` +
          `  Environment: ${input.environmentId}\n` +
          (input.host ? `  Host:        ${input.host}\n` : '') +
          `\nIf using a custom host configuration, make sure the space exists on that host.`,
      };
    }
    let outcome: Preview422Outcome;
    try {
      outcome = await handlePreview422(e, input.extractSessionId, deps.patchReviewState);
    } catch (error) {
      return {
        step: 'error',
        errorStep: 'apply preview',
        errorMessage: `Preview validation could not be recorded: ${String(error)}. Repair the review state before retrying.`,
        errorAllowCredentialRetry: false,
      };
    }
    if (outcome.kind === 'validation-error') {
      return {
        step: 'preview-validation-error',
        previewValidationErrors: outcome.errors,
        previewValidationMissingNames: outcome.missingNames,
      };
    }
    return {
      step: 'error',
      errorStep: 'apply preview',
      errorMessage: formatApiError({ error: e, verbose: deps.verboseErrors }),
      errorAllowCredentialRetry: true,
    };
  }
  return {
    step: 'error',
    errorStep: 'apply preview',
    errorMessage: e instanceof Error ? e.message : 'Preview failed',
    errorAllowCredentialRetry: true,
  };
}
