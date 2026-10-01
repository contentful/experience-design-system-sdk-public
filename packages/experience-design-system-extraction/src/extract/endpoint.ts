import type { RawComponentDefinition } from './model/component.js';
import type { ExtractionEndpointRequest, ExtractionEndpointResponse } from './model/contract.js';
import { extractComponents } from './pipeline.js';
import { isNonAuthorableComponent } from './non-authorable-filter.js';
import { computeExtractionScore, deriveNeedsReview } from './scoring.js';
import { inspectComponentSource, describeReviewReasons } from './source-inspection.js';
import { preClassifyComponent } from '../pre-classify.js';
import { validateExtractedComponents } from './validate.js';

export type {
  ExtractionEndpointProgress,
  ExtractionEndpointRequest,
  ExtractionEndpointResponse,
} from './model/contract.js';

function wrapperConfidenceToIssueCount(confidence: number): number {
  if (confidence >= 4) return 2;
  if (confidence === 3) return 1;
  return 0;
}

function validateRequest(request: ExtractionEndpointRequest): void {
  if (request === null || typeof request !== 'object') {
    throw new TypeError('extractEndpoint requires a request object');
  }

  if (!Array.isArray(request.filePaths)) {
    throw new TypeError('extractEndpoint requires filePaths to be an array');
  }

  if (request.filePaths.some((filePath) => typeof filePath !== 'string' || filePath.trim().length === 0)) {
    throw new TypeError('extractEndpoint requires filePaths to contain non-empty strings');
  }

  if (
    request.projectRoot !== undefined &&
    (typeof request.projectRoot !== 'string' || request.projectRoot.trim().length === 0)
  ) {
    throw new TypeError('extractEndpoint requires projectRoot to be a non-empty string when provided');
  }

  if (
    request.resolveUnreachable !== undefined &&
    request.resolveUnreachable !== 'auto' &&
    request.resolveUnreachable !== 'always' &&
    request.resolveUnreachable !== 'never'
  ) {
    throw new TypeError("extractEndpoint requires resolveUnreachable to be 'auto', 'always', or 'never'");
  }

  if (request.onProgress !== undefined && typeof request.onProgress !== 'function') {
    throw new TypeError('extractEndpoint requires onProgress to be a function when provided');
  }
}

/**
 * Stable in-process contract for the extraction engine.
 *
 * This endpoint owns extraction-time scoring, source inspection, filtering
 * signals, and validation. It does not scan directories, invoke agents, or
 * persist state; callers own those boundaries explicitly.
 */
export async function extractEndpoint(request: ExtractionEndpointRequest): Promise<ExtractionEndpointResponse> {
  validateRequest(request);
  const filePaths = [...request.filePaths];
  const extraction = await extractComponents(
    filePaths,
    ({ filesProcessed, componentsFound }) => {
      request.onProgress?.({
        phase: 'extract',
        filesProcessed,
        totalFiles: filePaths.length,
        componentsFound,
      });
    },
    {
      ...(request.resolveUnreachable !== undefined ? { resolveUnreachable: request.resolveUnreachable } : {}),
      ...(request.projectRoot !== undefined ? { projectRoot: request.projectRoot } : {}),
    },
  );
  request.onProgress?.({
    phase: 'extract',
    filesProcessed: filePaths.length,
    totalFiles: filePaths.length,
    componentsFound: extraction.components.length,
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
