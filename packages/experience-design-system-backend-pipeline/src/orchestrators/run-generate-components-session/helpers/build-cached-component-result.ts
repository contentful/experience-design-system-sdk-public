import type { GeneratedComponentResult } from '../types.js';

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
