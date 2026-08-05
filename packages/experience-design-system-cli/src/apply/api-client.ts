import type {
  ManifestPayload,
  ServerPreviewResponse,
  ApplyOperationResponse,
  BreakingChange,
} from '@contentful/experience-design-system-types';
import { DEFAULT_API_HOST, toApiHost } from '../host-utils.js';
import { getDebugLogger } from '../lib/debug-logger.js';
import { buildUserAgent } from '../lib/user-agent.js';

export const DEFAULT_HOST = DEFAULT_API_HOST;

export const PREVIEW_ERROR_PREFIX = 'preview failed:';
export const APPLY_ERROR_PREFIX = 'apply failed:';

// Substring match the orchestrator uses to distinguish a parseable
// component-level validation failure from generic 422s. Quoted because the
// match runs against the raw JSON body (which contains `"code":"ValidationFailed"`).
// If the server ever changes the casing or naming, isPreviewValidationError
// silently returns false and the retry loop never fires — so this lives next
// to the prefixes as a deliberate, named contract rather than an inline
// magic string in the orchestrator.
export const VALIDATION_FAILED_CODE = '"ValidationFailed"';

export interface ApiClientOptions {
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

const MAX_RETRY_AFTER_MS = 60_000;

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
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

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

// Cap on the body slice appended to ApiError.message. Bumped from 1000 →
// 16384 so realistic 422 ValidationFailed reports (which list every
// offending component, ~100 chars per error, easily exceeds 1KB once you
// cross ~10 components) survive intact through subprocess stderr. The
// orchestrator's parseOffendingComponentNames does JSON.parse on this slice
// and silently fails to recover any offenders if the JSON is mid-truncated.
// The cap stays in place to keep a runaway server response from blowing up
// log output.
const ERROR_BODY_LOG_CAP = 16384;

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

/**
 * Parse the JSON body of a 422 from `previewImport()` into structured
 * per-component validation errors. Returns [] for any malformed input
 * so callers can fall back to the generic error path without try/catch.
 *
 * Path shape: `manifest:components/<Name>/$slots/<key>` or
 * `manifest:components/<Name>/$properties/<key>`. Only the component
 * name is extracted today; `path` and `message` are kept verbatim so
 * future surfaces (debug logging, headless retry in SP-4) can render
 * the field-level detail.
 */
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

export function sanitizeBreakingChanges(raw: unknown): BreakingChange[] {
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

async function request(url: string, options: RequestInit & { token: string }): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.token}`,
    'Content-Type': 'application/json',
    'X-Contentful-User-Agent': buildUserAgent(),
  };

  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
  };
  if (options.body) init.body = options.body;

  return fetch(url, init);
}

export class ImportApiClient {
  private host: string;
  private token: string;
  private spaceId: string;
  private environmentId: string;
  private retry: RetryOptions;

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

  private base(): string {
    return `${this.host}/spaces/${this.spaceId}/environments/${this.environmentId}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'X-Contentful-User-Agent': buildUserAgent(),
    };
  }

  private async fetchWithRetry(
    phase: 'preview' | 'poll',
    url: string,
    init: RequestInit,
    context: Record<string, unknown> = {},
  ): Promise<Response> {
    const debug = getDebugLogger();
    const errorPrefix = phase === 'preview' ? PREVIEW_ERROR_PREFIX : 'poll failed:';
    const startedAt = Date.now();

    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      try {
        const response = await fetch(url, init);
        if (!isTransientStatus(response.status)) return response;

        const body = await response.text();
        if (attempt === this.retry.maxAttempts) {
          const guidance =
            `The ${phase} request failed after ${attempt} attempts because the service remained unavailable. ` +
            'Wait a moment and try again.';
          debug.event('apply', `${phase}.error`, {
            ...context,
            attempt,
            maxAttempts: this.retry.maxAttempts,
            status: response.status,
            reason: 'retry_exhausted',
            durationMs: Date.now() - startedAt,
            bodyHead: body.slice(0, 2000),
          });
          throw new ApiError(`${errorPrefix} ${response.status}`, response.status, body, guidance);
        }

        const backoffMs = Math.min(this.retry.initialDelayMs * 2 ** (attempt - 1), this.retry.maxDelayMs);
        const delayMs = retryAfterMs(response) ?? backoffMs;
        debug.event('apply', `${phase}.retry`, {
          ...context,
          attempt,
          maxAttempts: this.retry.maxAttempts,
          status: response.status,
          reason: 'http_5xx',
          delayMs,
        });
        await this.retry.sleep(delayMs);
      } catch (error) {
        if (error instanceof ApiError) throw error;

        if (attempt === this.retry.maxAttempts) {
          const body =
            `The request failed after ${attempt} attempts because of a network error: ${errorMessage(error)}. ` +
            'Check your connection and try again.';
          debug.event('apply', `${phase}.error`, {
            ...context,
            attempt,
            maxAttempts: this.retry.maxAttempts,
            status: 0,
            reason: 'transport_retry_exhausted',
            durationMs: Date.now() - startedAt,
          });
          throw new ApiError(`${errorPrefix} 0`, 0, body);
        }

        const delayMs = Math.min(this.retry.initialDelayMs * 2 ** (attempt - 1), this.retry.maxDelayMs);
        debug.event('apply', `${phase}.retry`, {
          ...context,
          attempt,
          maxAttempts: this.retry.maxAttempts,
          status: 0,
          reason: 'transport_error',
          delayMs,
        });
        await this.retry.sleep(delayMs);
      }
    }

    throw new Error('Retry attempts exhausted');
  }

  async validateToken(): Promise<void> {
    // /users/me is the canonical token-validity endpoint — avoids space-membership
    // false positives that don't apply to the design-systems API authorization path.
    const url = `${this.host}/users/me`;
    const res = await request(url, { token: this.token });
    if (res.status === 401) {
      throw new ApiError('CMA token is invalid or revoked', res.status, await res.text());
    }
    if (!res.ok) {
      throw new ApiError(`unexpected error validating token: ${res.status}`, res.status, await res.text());
    }
  }

  async previewImport(manifest: ManifestPayload): Promise<ServerPreviewResponse> {
    const url = `${this.base()}/design_systems/imports/preview`;
    const debug = getDebugLogger();
    const startedAt = Date.now();
    debug.event('apply', 'preview.request', {
      url,
      componentCount: (manifest as { components?: unknown[] }).components?.length ?? 0,
      tokenCount: (manifest as { designTokens?: unknown[] }).designTokens?.length ?? 0,
    });
    const res = await this.fetchWithRetry('preview', url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(manifest),
    });
    if (!res.ok) {
      const body = await res.text();
      debug.event('apply', 'preview.error', {
        status: res.status,
        durationMs: Date.now() - startedAt,
        bodyHead: body.slice(0, 2000),
      });
      throw new ApiError(`${PREVIEW_ERROR_PREFIX} ${res.status}`, res.status, body);
    }
    const parsed = (await res.json()) as ServerPreviewResponse;
    debug.event('apply', 'preview.ok', { status: res.status, durationMs: Date.now() - startedAt });
    return sanitizePreviewResponse(parsed);
  }

  async applyImport(manifest: ManifestPayload, acknowledgeBreakingChanges: boolean): Promise<ApplyOperationResponse> {
    const url = `${this.base()}/design_systems/imports/apply`;
    const debug = getDebugLogger();
    const startedAt = Date.now();
    debug.event('apply', 'apply.request', { url, acknowledgeBreakingChanges });
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ ...manifest, acknowledgeBreakingChanges }),
      });
    } catch (error) {
      const body =
        `The apply request was not retried because its outcome is unknown and retrying could start a duplicate operation. ` +
        `Check for an existing operation before trying again. Cause: ${errorMessage(error)}`;
      debug.event('apply', 'apply.error', {
        status: 0,
        durationMs: Date.now() - startedAt,
        reason: 'transport_error_not_retried',
      });
      throw new ApiError(`${APPLY_ERROR_PREFIX} 0`, 0, body);
    }
    if (!res.ok) {
      const body = await res.text();
      const guidance = isTransientStatus(res.status)
        ? 'The apply request was not retried because the server may already have started an operation and retrying could create a duplicate. Check for an existing operation before trying again.'
        : undefined;
      debug.event('apply', 'apply.error', {
        status: res.status,
        durationMs: Date.now() - startedAt,
        bodyHead: body.slice(0, 2000),
      });
      throw new ApiError(`${APPLY_ERROR_PREFIX} ${res.status}`, res.status, body, guidance);
    }
    const parsed = (await res.json()) as ApplyOperationResponse;
    debug.event('apply', 'apply.accepted', {
      status: res.status,
      operationId: parsed.sys?.id,
      durationMs: Date.now() - startedAt,
    });
    return parsed;
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
      const url = `${this.base()}/design_systems/imports/apply/${encodeURIComponent(operationId)}`;
      const res = await this.fetchWithRetry(
        'poll',
        url,
        {
          method: 'GET',
          headers: this.headers(),
        },
        { operationId },
      );
      if (!res.ok) {
        throw new ApiError(`poll failed: ${res.status}`, res.status, await res.text());
      }
      const op = (await res.json()) as ApplyOperationResponse;
      opts.onProgress?.(op);
      getDebugLogger().event('apply', 'poll.tick', {
        operationId,
        attempt,
        status: op.sys.status,
      });
      if (terminalStatuses.has(op.sys.status)) {
        getDebugLogger().event('apply', 'poll.terminal', {
          operationId,
          attempt,
          status: op.sys.status,
        });
        return op;
      }
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
