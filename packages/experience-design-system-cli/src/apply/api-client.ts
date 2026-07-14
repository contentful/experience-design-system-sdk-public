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

// Phase-prefix constants used at the two ApiError throw sites below and
// imported by orchestrator.ts to identify preview-phase 422s for retry.
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
  ) {
    super(message);
    if (body) {
      // Append a (possibly trimmed) version of the response body so callers
      // that only log e.message don't silently swallow the server's error
      // detail.
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

  constructor(opts: ApiClientOptions) {
    this.host = toApiHost(opts.host);
    this.token = opts.cmaToken;
    this.spaceId = opts.spaceId;
    this.environmentId = opts.environmentId;
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
    const res = await fetch(url, {
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
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ ...manifest, acknowledgeBreakingChanges }),
    });
    if (!res.ok) {
      const body = await res.text();
      debug.event('apply', 'apply.error', {
        status: res.status,
        durationMs: Date.now() - startedAt,
        bodyHead: body.slice(0, 2000),
      });
      throw new ApiError(`${APPLY_ERROR_PREFIX} ${res.status}`, res.status, body);
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
      const res = await fetch(url, {
        method: 'GET',
        headers: this.headers(),
      });
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
