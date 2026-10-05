import type { ExtractorProgress } from '../types/component.js';
import type { ExtractionEndpointResponse } from '../types/contract.js';
import type { ExtractorOptions } from '../types/options.js';
import { extractComponents } from './extraction/extract-components.js';
import { preClassifyComponent } from './classification/classify-component-props.js';
import { evaluateExtractionQuality } from './quality/evaluate-extraction-quality.js';

export interface ExtractionServiceRequest extends ExtractorOptions {
  readonly filePaths: readonly string[];
  onProgress?: (progress: ExtractorProgress) => void;
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
  return evaluateExtractionQuality(classifiedComponents, extraction.warnings);
}
