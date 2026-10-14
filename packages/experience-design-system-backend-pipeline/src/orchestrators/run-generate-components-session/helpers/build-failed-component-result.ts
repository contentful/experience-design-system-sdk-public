import type { GeneratedComponentResult } from '../types.js';

/** The result shape for a component whose agent run exhausted retries. */
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
