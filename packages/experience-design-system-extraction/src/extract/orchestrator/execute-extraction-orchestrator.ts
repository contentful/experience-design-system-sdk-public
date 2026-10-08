import type { ExtractorProgress } from '../types/component.js';
import type { ExtractionEndpointResponse } from '../types/contract.js';
import type { ExtractorOptions } from '../types/options.js';
import { extractComponents } from '../services/extraction/extract-components.js';
import { preClassifyComponent } from '../services/classification/classify-component-props.js';
import { evaluateExtractionQuality } from '../services/quality/evaluate-extraction-quality.js';

export interface ExtractionOrchestratorRequest extends ExtractorOptions {
  readonly filePaths: readonly string[];
  onProgress?: (progress: ExtractorProgress) => void;
}

/**
 * Executes the extraction use case after the controller has validated the
 * public request. Owns extraction-time classification, inspection,
 * quality signals, scoring, and validation, but not transport or persistence.
 */
export async function executeExtractionOrchestrator(
  request: ExtractionOrchestratorRequest,
): Promise<ExtractionEndpointResponse> {
  const filePaths = [...request.filePaths];
  const extraction = await extractComponents(filePaths, request.onProgress, {
    ...(request.resolveUnreachable !== undefined ? { resolveUnreachable: request.resolveUnreachable } : {}),
    ...(request.projectRoot !== undefined ? { projectRoot: request.projectRoot } : {}),
  });

  const classifiedComponents = extraction.components.map(preClassifyComponent);
  return evaluateExtractionQuality(classifiedComponents, extraction.warnings);
}
