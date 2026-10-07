import {
  designSystemImportApply,
  designSystemImportGetOperation,
  designSystemImportSourcelessPreview,
} from '@contentful/experience-design-system-client';
import type {
  ApplyOperationResponse,
  BreakingChange,
  CDFDocument,
  ServerPreviewResponse,
} from '@contentful/experience-design-system-types';
import { toApiHost } from '../helpers/host-utils.js';

export const PREVIEW_ERROR_PREFIX = 'preview failed:';
export const APPLY_ERROR_PREFIX = 'apply failed:';

const USER_AGENT = 'experience-design-system-backend-pipeline';
const ERROR_BODY_LOG_CAP = 16384;
const MAX_RETRY_AFTER_MS = 60_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
    public readonly guidance?: string,
  ) {
    super(message);
    if (body) {
      const trimmed = body.length > ERROR_BODY_LOG_CAP ? body.slice(0, ERROR_BODY_LOG_CAP) + '…' : body;
      this.message = `${message}\n${trimmed}`;
    }
  }
}

export interface PreviewValidationError {
  componentName: string;
  path: string;
  message: string;
}

const COMPONENT_PATH_PREFIX = 'manifest:components/';

export function parsePreviewValidationErrors(body: string): PreviewValidationError[] {
  if (!body) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const details = (parsed as { details?: unknown })?.details;
  const errors = (details as { errors?: unknown })?.errors;
  if (!Array.isArray(errors)) return [];
  const out: PreviewValidationError[] = [];
  for (const raw of errors) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as { path?: unknown; message?: unknown };
    if (typeof entry.path !== 'string' || typeof entry.message !== 'string') continue;
    if (!entry.path.startsWith(COMPONENT_PATH_PREFIX)) continue;
    const tail = entry.path.slice(COMPONENT_PATH_PREFIX.length);
    const slash = tail.indexOf('/');
    const componentName = slash === -1 ? tail : tail.slice(0, slash);
    if (!componentName) continue;
    out.push({ componentName, path: entry.path, message: entry.message });
  }
  return out;
}

const PROPERTY_BREAKING_REASONS = new Set([
  'removed',
  'added_required_no_default',
  'type_changed',
  'validation_narrowed',
]);
const SLOT_BREAKING_REASONS = new Set(['slot_removed', 'slot_allowed_components_narrowed']);

function sanitizeBreakingChanges(raw: unknown): BreakingChange[] {
  if (!Array.isArray(raw)) return [];
  const out: BreakingChange[] = [];
  for (const bc of raw) {
    if (typeof bc !== 'object' || bc === null) continue;
    const reason = (bc as { reason?: unknown }).reason;
    if (typeof reason !== 'string') continue;
    if ('propertyId' in bc && typeof (bc as { propertyId?: unknown }).propertyId === 'string') {
      if (PROPERTY_BREAKING_REASONS.has(reason)) out.push(bc as BreakingChange);
      continue;
    }
    if ('slotId' in bc && typeof (bc as { slotId?: unknown }).slotId === 'string') {
      if (SLOT_BREAKING_REASONS.has(reason)) out.push(bc as BreakingChange);
      continue;
    }
  }
  return out;
}

function sanitizePreviewResponse(res: ServerPreviewResponse): ServerPreviewResponse {
  for (const item of res.components?.changed ?? []) {
    const cc = item.changeClassification;
    if (cc && Array.isArray(cc.breakingChanges)) {
      cc.breakingChanges = sanitizeBreakingChanges(cc.breakingChanges);
    }
  }
  return res;
}

function isApsDenialBody(body: string): boolean {
  if (!body) return false;
  try {
    const parsed = JSON.parse(body) as { sys?: { id?: unknown } };
    const id = parsed?.sys?.id;
    return id === 'NotFound' || id === 'AccessDenied';
  } catch {
    return false;
  }
}

function isTransientStatus(status: number): boolean {
  return status >= 500 && status <= 599;
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers?.get('retry-after')?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  const delayMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > MAX_RETRY_AFTER_MS) return undefined;
  return Math.round(delayMs);
}

function stringifyError(error: unknown): string {
  return typeof error === 'string' ? error : JSON.stringify(error ?? {});
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export interface ImportApiClientOptions {
  host?: string;
  cmaToken: string;
  spaceId: string;
  environmentId: string;
  retry?: {
    maxAttempts?: number;
    initialDelayMs?: number;
    maxDelayMs?: number;
    sleep?: (delayMs: number) => Promise<void>;
  };
}

interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  sleep: (delayMs: number) => Promise<void>;
}

export class ImportApiClient {
  private host: string;
  private token: string;
  private spaceId: string;
  private environmentId: string;
  private retry: RetryOptions;
  private lastRequestId?: string;

  constructor(opts: ImportApiClientOptions) {
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
        const delayMs = Math.min(this.retry.initialDelayMs * 2 ** (attempt - 1), this.retry.maxDelayMs);
        await this.retry.sleep(delayMs);
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
      const delayMs = retryAfterMs(result.response) ?? backoffMs;
      await this.retry.sleep(delayMs);
    }

    throw new Error('Retry attempts exhausted');
  }

  async validateToken(): Promise<void> {
    const res = await fetch(`${this.host}/users/me`, {
      headers: this.headers(),
    });
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
      designSystemImportSourcelessPreview({
        baseUrl: this.host,
        headers: this.headers(),
        path: { spaceId: this.spaceId, environmentId: this.environmentId },
        body: cdf as never,
        parseAs: 'json',
      }),
    );
    if (!result.response.ok) {
      throw new ApiError(
        `${PREVIEW_ERROR_PREFIX} ${result.response.status}`,
        result.response.status,
        stringifyError(result.error),
      );
    }
    return sanitizePreviewResponse(result.data as unknown as ServerPreviewResponse);
  }

  async applyImport(
    cdf: CDFDocument,
    options: { acknowledgeBreakingChanges: boolean },
  ): Promise<ApplyOperationResponse> {
    let result: Awaited<ReturnType<typeof designSystemImportApply<false>>>;
    try {
      result = await designSystemImportApply<false>({
        baseUrl: this.host,
        headers: this.headers(),
        path: { spaceId: this.spaceId, environmentId: this.environmentId },
        body: { ...cdf, acknowledgeBreakingChanges: options.acknowledgeBreakingChanges } as never,
        parseAs: 'json',
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
    return result.data as unknown as ApplyOperationResponse;
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
        designSystemImportGetOperation({
          baseUrl: this.host,
          headers: this.headers(),
          path: { spaceId: this.spaceId, environmentId: this.environmentId, operationId },
          parseAs: 'json',
        }),
      );
      if (!result.response.ok) {
        throw new ApiError(
          `poll failed: ${result.response.status}`,
          result.response.status,
          stringifyError(result.error),
        );
      }
      const op = result.data as unknown as ApplyOperationResponse;
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
