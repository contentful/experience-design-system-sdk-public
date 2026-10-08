import { resolve } from 'node:path';
import { configRoot } from '../../session/helpers/config-root.js';

export function getRefineArtifactsRoot(): string {
  if (process.env['EDS_REVIEW_ARTIFACTS_DIR']) {
    return resolve(process.env['EDS_REVIEW_ARTIFACTS_DIR']);
  }
  return resolve(configRoot(), 'reviews');
}
