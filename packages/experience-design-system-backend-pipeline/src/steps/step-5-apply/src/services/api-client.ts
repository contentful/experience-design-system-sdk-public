import { applyImport, getOperation, previewImport } from '../client/import-endpoints.js';
import type { ApplyOperationResponse, CDFDocument, ServerPreviewResponse } from '../../../shared/types/index.js';
import {
  isApsDenialBody,
  isTransientStatus,
  retryAfterMs,
  stringifyError,
  errorMessage,
  defaultSleep,
} from '../helpers/http-utils.js';
import { sanitizePreviewResponse } from '../helpers/sanitize-preview.js';
import { toApiHost } from '../helpers/host-utils.js';
import { ApiError } from '../types/api-error.js';
import type { ApiClientOptions } from '../types/contract.js';

export const PREVIEW_ERROR_PREFIX = 'preview failed:';
export const APPLY_ERROR_PREFIX = 'apply failed:';

const USER_AGENT = 'experience-design-system-backend-pipeline';

interface RetryConfig {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  sleep: (delayMs: number) => Promise<void>;
}

export class ApiClient {
  private host: string;
  private token: string;
  private spaceId: string;
  private environmentId: string;
  private retry: RetryConfig;
  private lastRequestId?: string;

  constructor(opts: ApiClientOptions) {
    this.host = toApiHost(opts.host);
    this.token = opts.cmaToken;
    this.spaceId = opts.spaceId;
    this.environmentId = opts.environmentId;
    const initialDelayMs = Math.max(0, opts.retry?.initialDelayMs ?? 250);
    this.retry = {
      maxAttempts: Math.max(1, Math.floor(opts.retry?.maxAttempts ?? 3)),
      initialDelayMs,
      maxDelayMs: Math.max(initialDelayMs, opts.retry?.maxDelayMs ?? 2000),
      sleep: opts.retry?.sleep ?? defaultSleep,
    };
  }

  getLastRequestId(): string | undefined {
    return this.lastRequestId;
  }

  private noteRequestId(response: Response): void {
    const id = response.headers.get('x-contentful-request-id');
    if (id) this.lastRequestId = id;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'X-Contentful-User-Agent': USER_AGENT,
    };
  }

  private async requestWithRetry<TData, TError>(
    phase: 'preview' | 'poll',
    errorPrefix: string,
    makeCall: () => Promise<{ data?: TData; error?: TError; response: Response }>,
  ): Promise<{ data?: TData; error?: TError; response: Response }> {
    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      let result: { data?: TData; error?: TError; response: Response };
      try {
        result = await makeCall();
      } catch (error) {
        if (attempt === this.retry.maxAttempts) {
          const body = `The request failed after ${attempt} attempts because of a network error: ${errorMessage(error)}. Check your connection and try again.`;
          throw new ApiError(`${errorPrefix} 0`, 0, body);
        }
        await this.retry.sleep(Math.min(this.retry.initialDelayMs * 2 ** (attempt - 1), this.retry.maxDelayMs));
        continue;
      }

      if (!isTransientStatus(result.response.status)) {
        this.noteRequestId(result.response);
        return result;
      }

      if (attempt === this.retry.maxAttempts) {
        const body = stringifyError(result.error);
        const guidance = `The ${phase} request failed after ${attempt} attempts because the service remained unavailable. Wait a moment and try again.`;
        throw new ApiError(`${errorPrefix} ${result.response.status}`, result.response.status, body, guidance);
      }

      const backoffMs = Math.min(this.retry.initialDelayMs * 2 ** (attempt - 1), this.retry.maxDelayMs);
      await this.retry.sleep(retryAfterMs(result.response) ?? backoffMs);
    }

    throw new Error('Retry attempts exhausted');
  }

  async validateToken(): Promise<void> {
    const res = await fetch(`${this.host}/users/me`, { headers: this.headers() });
    this.noteRequestId(res);
    if (res.status === 401) {
      throw new ApiError('CMA token is invalid or revoked', res.status, await res.text());
    }
    if (!res.ok) {
      throw new ApiError(`unexpected error validating token: ${res.status}`, res.status, await res.text());
    }
    await this.checkPreflight();
  }

  async checkPreflight(): Promise<void> {
    const url = `${this.host}/spaces/${this.spaceId}/environments/${this.environmentId}/design_systems/preflight`;
    let res: Response;
    try {
      res = await fetch(url, { headers: this.headers() });
    } catch {
      return;
    }
    this.noteRequestId(res);
    if (res.ok) return;
    if (res.status >= 500) return;
    const body = await res.text();
    if (res.status === 404 && !isApsDenialBody(body)) return;
    throw new ApiError(`preflight failed: ${res.status}`, res.status, body);
  }

  async previewImport(cdf: CDFDocument): Promise<ServerPreviewResponse> {
    const result = await this.requestWithRetry('preview', PREVIEW_ERROR_PREFIX, () =>
      previewImport({
        baseUrl: this.host,
        headers: this.headers(),
        path: { spaceId: this.spaceId, environmentId: this.environmentId },
        body: cdf,
      }),
    );
    if (!result.response.ok) {
      throw new ApiError(
        `${PREVIEW_ERROR_PREFIX} ${result.response.status}`,
        result.response.status,
        stringifyError(result.error),
      );
    }
    return sanitizePreviewResponse(result.data as ServerPreviewResponse);
  }

  async applyImport(cdf: CDFDocument, opts: { acknowledgeBreakingChanges: boolean }): Promise<ApplyOperationResponse> {
    let result: Awaited<ReturnType<typeof applyImport>>;
    try {
      result = await applyImport({
        baseUrl: this.host,
        headers: this.headers(),
        path: { spaceId: this.spaceId, environmentId: this.environmentId },
        body: { ...cdf, acknowledgeBreakingChanges: opts.acknowledgeBreakingChanges },
      });
    } catch (error) {
      const body = `The apply request was not retried because its outcome is unknown and retrying could start a duplicate operation. Cause: ${errorMessage(error)}`;
      throw new ApiError(`${APPLY_ERROR_PREFIX} 0`, 0, body);
    }
    if (!result.response.ok) {
      const body = stringifyError(result.error);
      const guidance = isTransientStatus(result.response.status)
        ? 'The apply request was not retried because the server may already have started an operation and retrying could create a duplicate.'
        : undefined;
      throw new ApiError(`${APPLY_ERROR_PREFIX} ${result.response.status}`, result.response.status, body, guidance);
    }
    this.noteRequestId(result.response);
    return result.data as ApplyOperationResponse;
  }

  async pollOperation(
    operationId: string,
    opts: {
      intervalMs?: number;
      maxIntervalMs?: number;
      maxAttempts?: number;
      onProgress?: (op: ApplyOperationResponse) => void;
    } = {},
  ): Promise<ApplyOperationResponse> {
    const intervalMs = opts.intervalMs ?? 2000;
    const maxIntervalMs = opts.maxIntervalMs ?? Math.round(intervalMs * 2.5);
    const maxAttempts = opts.maxAttempts ?? 150;
    const terminalStatuses = new Set(['succeeded', 'partial', 'failed']);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await this.requestWithRetry('poll', 'poll failed:', () =>
        getOperation({
          baseUrl: this.host,
          headers: this.headers(),
          path: { spaceId: this.spaceId, environmentId: this.environmentId, operationId },
        }),
      );
      if (!result.response.ok) {
        throw new ApiError(
          `poll failed: ${result.response.status}`,
          result.response.status,
          stringifyError(result.error),
        );
      }
      const op = result.data as ApplyOperationResponse;
      opts.onProgress?.(op);
      if (terminalStatuses.has(op.sys.status)) return op;
      if (attempt < maxAttempts - 1) {
        const progress = maxAttempts > 1 ? attempt / (maxAttempts - 1) : 0;
        const baseDelay = intervalMs + (maxIntervalMs - intervalMs) * progress;
        const jitter = Math.random() * baseDelay * 0.15;
        await new Promise((resolve) => setTimeout(resolve, baseDelay + jitter));
      }
    }
    throw new Error(`Operation ${operationId} timed out after ${maxAttempts} attempts`);
  }
}
