import type { GeneratedComponentResult } from '../types.js';

export function buildFailedComponentResult(
  componentName: string,
  error: string,
  renamedSlotsCount: number,
): GeneratedComponentResult {
  return {
    componentName,
    classified: 0,
    excluded: 0,
    slots: 0,
    warnings: [],
    failed: true,
    error,
    cached: false,
    renamedSlotsCount,
  };
}
