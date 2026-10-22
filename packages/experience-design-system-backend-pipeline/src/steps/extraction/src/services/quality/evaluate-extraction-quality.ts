import type { RawComponentDefinition } from '../../types/component.js';
import type { ExtractionEndpointResponse } from '../../types/contract.js';
import { hasNoAuthoringSurface } from './helpers/authorability/evaluate-authorability.js';
import { inspectComponentSource, describeReviewReasons } from './helpers/inspection/inspect-component-source.js';
import { validateExtractedComponents } from './helpers/inspection/validate-extracted-components.js';

/** Applies captured source inspection, missing-surface review and validation to retained models. */
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

  const reviewedComponents: RawComponentDefinition[] = [];
  const warnings: string[] = [...initialWarnings];

  for (const { component, inspection } of inspectedComponents) {
    const verdict = hasNoAuthoringSurface(component);
    const keepDespiteZeroSurface =
      verdict.skip && verdict.reason === 'component has no props and no slots' && inspection.keepDespiteZeroSurface;
    const retainedForReview = verdict.skip && !keepDespiteZeroSurface;

    if (retainedForReview) {
      warnings.push(`${component.name}: requires operator review (${verdict.reason})`);
    }

    if (keepDespiteZeroSurface) {
      warnings.push(
        `${component.name}: retained despite 0 props/slots because captured component source includes returned markup`,
      );
    }

    if (inspection.reviewReasons.length > 0) {
      const reviewNotes = describeReviewReasons(inspection.reviewReasons)
        .filter((note) => note !== 'high-confidence data-fetch wrapper')
        .join('; ');
      if (reviewNotes) warnings.push(`${component.name}: ${reviewNotes}`);
    }

    const extractorReasons = component.reviewReasons ?? [];
    const surfaceReviewReason = retainedForReview ? [`surface-unobserved:${verdict.reason}`] : [];
    const reasons = [...new Set([...extractorReasons, ...inspection.reviewReasons, ...surfaceReviewReason])];

    reviewedComponents.push({
      ...component,
      reviewReasons: reasons,
      needsReview:
        inspection.wrapperConfidence >= 4 ||
        inspection.keepDespiteZeroSurface ||
        retainedForReview ||
        extractorReasons.includes('props-type-unresolved') ||
        (component.needsReview ?? false),
    });
  }

  return {
    components: validateExtractedComponents(reviewedComponents),
    warnings,
  };
}
