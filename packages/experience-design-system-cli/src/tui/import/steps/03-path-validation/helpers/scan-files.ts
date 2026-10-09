import { collectFiles } from '@contentful/experience-design-system-backend-pipeline';
import { toScanResult } from './to-scan-result.js';
import type { ScanResult } from '../logic.js';

export function scanFiles(directory: string): ScanResult {
  return toScanResult(collectFiles(directory));
}
