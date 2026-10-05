import type { RawComponentDefinition } from './component.js';

/** Removes internal scoring fields from a component before showing it in the editor or writing it to disk. */
export function stripScoringFields({
  extractionConfidence: _c,
  reviewReasons: _r,
  needsReview: _n,
  ...rest
}: RawComponentDefinition): Omit<RawComponentDefinition, 'extractionConfidence' | 'reviewReasons' | 'needsReview'> {
  return rest;
}
