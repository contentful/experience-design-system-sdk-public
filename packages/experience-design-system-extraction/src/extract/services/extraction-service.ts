import type { ExtractorProgress } from '../model/component.js';
import type { ExtractionEndpointResponse } from '../model/contract.js';
import type { ExtractorOptions } from '../model/options.js';
import { extractComponents } from '../pipeline.js';
import { preClassifyComponent } from './classification-service.js';
import { evaluateExtractionQuality } from './quality-service.js';

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
