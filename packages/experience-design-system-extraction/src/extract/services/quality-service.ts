import type { RawComponentDefinition } from '../model/component.js';
import type { ExtractionEndpointResponse } from '../model/contract.js';
import { isNonAuthorableComponent } from '../policies/quality/authorability.js';
import { computeExtractionScore, deriveNeedsReview } from '../policies/quality/scoring.js';
import { inspectComponentSource, describeReviewReasons } from '../policies/quality/source-inspection.js';
import { validateExtractedComponents } from '../policies/quality/validation.js';

function wrapperConfidenceToIssueCount(confidence: number): number {
  if (confidence >= 4) return 2;
  if (confidence === 3) return 1;
  return 0;
}

/** Applies inspection, authorability, scoring, review, and validation policies to extracted models. */
export async function evaluateExtractionQuality(
  components: readonly RawComponentDefinition[],
  initialWarnings: readonly string[] = [],
): Promise<ExtractionEndpointResponse> {
  const inspectedComponents = await Promise.all(
    components.map(async (component) => ({
      component,
      inspection: await inspectComponentSource(component),
    })),
  );

  const scoredComponents: RawComponentDefinition[] = [];
  const warnings: string[] = [...initialWarnings];

  for (const { component, inspection } of inspectedComponents) {
    const verdict = isNonAuthorableComponent(component);
    const keepDespiteZeroSurface =
      verdict.skip && verdict.reason === 'component has no props and no slots' && inspection.keepDespiteZeroSurface;
    const retainedForReview = verdict.skip && !keepDespiteZeroSurface;

    if (retainedForReview) {
      warnings.push(`${component.name}: requires operator review (${verdict.reason})`);
    }

    if (keepDespiteZeroSurface) {
      warnings.push(
        `${component.name}: retained despite 0 props/slots because the source renders visible or compositional UI`,
      );
    }

    if (inspection.reviewReasons.length > 0) {
      const reviewNotes = describeReviewReasons(inspection.reviewReasons)
        .filter((note) => note !== 'high-confidence data-fetch wrapper')
        .join('; ');
      if (reviewNotes) warnings.push(`${component.name}: ${reviewNotes}`);
    }

    const extractorReasons = component.reviewReasons ?? [];
    const nonAuthorableReason = retainedForReview ? [`non-authorable:${verdict.reason}`] : [];
    const { confidence, reasons } = computeExtractionScore(component, {
      additionalIssueCount:
        wrapperConfidenceToIssueCount(inspection.wrapperConfidence) +
        extractorReasons.length +
        nonAuthorableReason.length,
      additionalReasons: [...extractorReasons, ...inspection.reviewReasons, ...nonAuthorableReason],
    });

    scoredComponents.push({
      ...component,
      extractionConfidence: confidence,
      reviewReasons: reasons,
      needsReview:
        deriveNeedsReview(confidence) ||
        inspection.wrapperConfidence >= 4 ||
        inspection.keepDespiteZeroSurface ||
        retainedForReview ||
        extractorReasons.includes('props-type-unresolved') ||
        (component.needsReview ?? false),
    });
  }

  return {
    components: validateExtractedComponents(scoredComponents),
    warnings,
  };
}
