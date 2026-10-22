import type { ComponentExtractionResult } from '../../../steps/extraction/src/types/component.js';

/** Report extractor-owned source exclusions without guessing property roles or wiring. */
export function emitPreClassificationExclusions(
  extraction: ComponentExtractionResult,
  onExclusion: ((exclusion: Record<string, unknown>) => void) | undefined,
): void {
  if (!onExclusion) return;
  for (const exclusion of extraction.exclusions ?? []) onExclusion({ ...exclusion });
}
