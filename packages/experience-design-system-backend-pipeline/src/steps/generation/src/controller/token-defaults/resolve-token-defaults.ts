import { resolveTokenDefaults as impl } from '../../helpers/token-defaults/resolve-token-defaults.js';
import type { DTCGTokenLeaf, RawDesignTokenDefault, ResolveTokenDefaultsResult } from '../../types/token-defaults.js';

export type { RawDesignTokenDefault, DTCGTokenLeaf, ResolveTokenDefaultsResult };

export interface ResolveTokenDefaultsRequest {
  defaults: readonly RawDesignTokenDefault[];
  leaves: readonly DTCGTokenLeaf[];
}

export function resolveTokenDefaults(request: ResolveTokenDefaultsRequest): ResolveTokenDefaultsResult {
  return impl(request.defaults, request.leaves);
}
