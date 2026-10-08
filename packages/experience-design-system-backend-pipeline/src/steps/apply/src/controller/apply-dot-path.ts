import { applyDotPath as impl, type ApplyDotPathResult } from '../helpers/apply-dot-path.js';

export interface ApplyDotPathRequest {
  obj: Record<string, unknown>;
  path: string;
  value: unknown;
}

export function applyDotPath(request: ApplyDotPathRequest): ApplyDotPathResult {
  return impl(request.obj, request.path, request.value);
}
