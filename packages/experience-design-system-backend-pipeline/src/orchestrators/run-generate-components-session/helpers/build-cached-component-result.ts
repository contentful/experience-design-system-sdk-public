import type { GeneratedComponentResult } from '../types.js';

/** The result shape for a component served from the cache (no agent invocation). */
export function buildCachedComponentResult(componentName: string, warnings: string[] = []): GeneratedComponentResult {
  return {
    componentName,
    classified: 0,
    excluded: 0,
    slots: 0,
    warnings,
    failed: false,
    cached: true,
    renamedSlotsCount: 0,
  };
}
