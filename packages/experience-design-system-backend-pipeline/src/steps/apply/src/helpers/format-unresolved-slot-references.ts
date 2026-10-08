import type { CDFValidationError } from '../../../shared/index.js';

/** Multi-line stderr-ready report of unresolved slot `$allowedComponents` references. */
export function formatUnresolvedSlotReferences(errors: CDFValidationError[]): string[] {
  const lines = ['Error: CDF slot $allowedComponents references failed to resolve locally. Push refused.'];
  for (const error of errors) {
    lines.push(`  - ${error.message} (${error.path})`);
  }
  return lines;
}
