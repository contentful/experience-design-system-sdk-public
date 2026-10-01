import type { RawComponentDefinition, ExtractorProgress } from '../model/component.js';
import type { ExtractionEndpointResponse } from '../model/contract.js';
import type { ExtractorOptions } from '../model/options.js';
import { extractComponents } from '../pipeline.js';
import { isNonAuthorableComponent } from '../non-authorable-filter.js';
import { computeExtractionScore, deriveNeedsReview } from '../scoring.js';
import { inspectComponentSource, describeReviewReasons } from '../source-inspection.js';
import { preClassifyComponent } from '../../pre-classify.js';
import { validateExtractedComponents } from '../validate.js';

export interface ExtractionServiceRequest extends ExtractorOptions {
  readonly filePaths: readonly string[];
  onProgress?: (progress: ExtractorProgress) => void;
}

function wrapperConfidenceToIssueCount(confidence: number): number {
  if (confidence >= 4) return 2;
  if (confidence === 3) return 1;
  return 0;
}

/**
 * Executes the extraction use case after the controller has validated the
 * public request. This service owns extraction-time classification, inspection,
 * quality signals, scoring, and validation, but not transport or persistence.
 */
export async function runExtractionService(request: ExtractionServiceRequest): Promise<ExtractionEndpointResponse> {
  const filePaths = [...request.filePaths];
  const extraction = await extractComponents(filePaths, request.onProgress, {
    ...(request.resolveUnreachable !== undefined ? { resolveUnreachable: request.resolveUnreachable } : {}),
    ...(request.projectRoot !== undefined ? { projectRoot: request.projectRoot } : {}),
  });

  const classifiedComponents = extraction.components.map(preClassifyComponent);
  const inspectedComponents = await Promise.all(
    classifiedComponents.map(async (component) => ({
      component,
      inspection: await inspectComponentSource(component),
    })),
  );

  const scoredComponents: RawComponentDefinition[] = [];
  const warnings: string[] = [...extraction.warnings];

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
