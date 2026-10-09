import { collectFiles } from '@contentful/experience-design-system-backend-pipeline';
import { toScanResult } from './to-scan-result.js';
import type { ScanResult } from '../logic.js';

/**
 * Scan the project path with the pipeline's walker so counts shown on
 * this screen match exactly what extract will later walk.
 */
export function scanFiles(directory: string): ScanResult {
  return toScanResult(collectFiles(directory));
}
