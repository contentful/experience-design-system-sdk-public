import type { RawComponentDefinition } from '../../model/component.js';
import type { ExtractionConfidence, ExtractionScore, ExtractionScoreOptions } from '../../model/scoring.js';
import { countExtractionIssues, mapIssueCountToConfidence } from './helpers/scoring-signals.js';

export type { ExtractionConfidence, ExtractionScore, ExtractionScoreOptions } from '../../model/scoring.js';

export function computeExtractionScore(
  component: RawComponentDefinition,
  options: ExtractionScoreOptions = {},
): ExtractionScore {
  const { count, reasons } = countExtractionIssues(component, options);
  return {
    confidence: mapIssueCountToConfidence(count),
    reasons,
  };
}

/** Returns true when the confidence score is low enough to require human review. */
export function deriveNeedsReview(confidence: ExtractionConfidence): boolean {
  return confidence <= 2;
}
