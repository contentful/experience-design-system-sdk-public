import type {
  ManifestPayload,
  ServerPreviewResponse,
  ApplyOperationResponse,
} from '@contentful/experience-design-system-types';
import { DEFAULT_API_HOST, toApiHost } from '../host-utils.js';

export const DEFAULT_HOST = DEFAULT_API_HOST;

export interface ApiClientOptions {
  host?: string;
  cmaToken: string;
  spaceId: string;
  environmentId: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    if (body) {
      // Append a trimmed version of the response body so callers that only
      // log e.message don't silently swallow the server's error detail.
      const trimmed = body.length > 1000 ? body.slice(0, 1000) + '…' : body;
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

async function request(url: string, options: RequestInit & { token: string }): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.token}`,
    'Content-Type': 'application/json',
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
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(manifest),
    });
    if (!res.ok) {
      throw new ApiError(`preview failed: ${res.status}`, res.status, await res.text());
    }
    return (await res.json()) as ServerPreviewResponse;
  }

  async applyImport(manifest: ManifestPayload, acknowledgeBreakingChanges: boolean): Promise<ApplyOperationResponse> {
    const url = `${this.base()}/design_systems/imports/apply`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ ...manifest, acknowledgeBreakingChanges }),
    });
    if (!res.ok) {
      throw new ApiError(`apply failed: ${res.status}`, res.status, await res.text());
    }
    return (await res.json()) as ApplyOperationResponse;
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
      if (terminalStatuses.has(op.sys.status)) {
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
