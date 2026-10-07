import { extractComponents } from '@contentful/experience-design-system-extraction';
import type { ExtractComponentsRequest, ExtractComponentsResponse } from '../types/contract.js';

export async function runExtractionService(request: ExtractComponentsRequest): Promise<ExtractComponentsResponse> {
  const { filePaths, projectRoot, opts, onProgress } = request;
  return extractComponents(
    filePaths,
    onProgress ? (p) => onProgress({ ...p, phase: 'extract' }) : undefined,
    { ...opts, projectRoot: projectRoot ?? opts?.projectRoot },
  );
}
