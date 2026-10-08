import { applyDotPath as impl, type ApplyDotPathResult } from '../../helpers/apply-dot-path.js';

export interface MutateDotPathRequest {
  obj: Record<string, unknown>;
  path: string;
  value: unknown;
}

export function mutateDotPath(request: MutateDotPathRequest): ApplyDotPathResult {
  return impl(request.obj, request.path, request.value);
}

// Legacy-name alias used by cli-legacy call sites — remove after TUI swap.
export { mutateDotPath as applyDotPath };
export type { MutateDotPathRequest as ApplyDotPathRequest };
