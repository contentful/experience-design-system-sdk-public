import { runProfiledImport as runBackendProfiledImport } from '../../packages/experience-design-system-backend-pipeline/dist/src/profiling/profiled-import.js';
import { renderProfileReport } from './report.mjs';

export function runProfiledImport(options) {
  return runBackendProfiledImport({ renderReport: renderProfileReport, ...options });
}
