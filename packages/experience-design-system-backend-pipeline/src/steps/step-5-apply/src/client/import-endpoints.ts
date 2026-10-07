import type { ApplyOperationResponse, CDFDocument, ServerPreviewResponse } from '../../../shared/types/index.js';

export interface EndpointCallOptions {
  baseUrl: string;
  headers: Record<string, string>;
  path: { spaceId: string; environmentId: string; operationId?: string };
  body?: unknown;
}

export interface EndpointResult<T> {
  response: Response;
  data?: T;
  error?: unknown;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<EndpointResult<T>> {
  const response = await fetch(url, init);
  const text = await response.text();
  const parsed = text ? safeJsonParse(text) : undefined;
  if (response.ok) return { response, data: parsed as T };
  return { response, error: parsed ?? text };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function previewImport(
  opts: EndpointCallOptions & { body: CDFDocument },
): Promise<EndpointResult<ServerPreviewResponse>> {
  const url = `${opts.baseUrl}/spaces/${opts.path.spaceId}/environments/${opts.path.environmentId}/design_systems/imports/preview`;
  return fetchJson<ServerPreviewResponse>(url, {
    method: 'POST',
    headers: opts.headers,
    body: JSON.stringify(opts.body),
  });
}

export function applyImport(
  opts: EndpointCallOptions & { body: CDFDocument & { acknowledgeBreakingChanges: boolean } },
): Promise<EndpointResult<ApplyOperationResponse>> {
  const url = `${opts.baseUrl}/spaces/${opts.path.spaceId}/environments/${opts.path.environmentId}/design_systems/imports/apply`;
  return fetchJson<ApplyOperationResponse>(url, {
    method: 'POST',
    headers: opts.headers,
    body: JSON.stringify(opts.body),
  });
}

export function getOperation(opts: EndpointCallOptions): Promise<EndpointResult<ApplyOperationResponse>> {
  const operationId = opts.path.operationId;
  if (!operationId) throw new Error('getOperation requires path.operationId');
  const url = `${opts.baseUrl}/spaces/${opts.path.spaceId}/environments/${opts.path.environmentId}/design_systems/imports/apply/${operationId}`;
  return fetchJson<ApplyOperationResponse>(url, { method: 'GET', headers: opts.headers });
}
