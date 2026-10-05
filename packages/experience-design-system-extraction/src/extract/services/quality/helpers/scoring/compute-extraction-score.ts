import type { RawComponentDefinition } from '../../../../types/component.js';
import type { ExtractionConfidence, ExtractionScore, ExtractionScoreOptions } from '../../../../types/scoring.js';
import { countExtractionIssues, mapIssueCountToConfidence } from './collect-scoring-inputs.js';

export type { ExtractionConfidence, ExtractionScore, ExtractionScoreOptions } from '../../../../types/scoring.js';

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
