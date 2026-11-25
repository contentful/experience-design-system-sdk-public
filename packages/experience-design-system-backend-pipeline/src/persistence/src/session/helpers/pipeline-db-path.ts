import { resolve } from 'node:path';
import { configRoot } from './config-root.js';

export function getPipelineDbPath(): string {
  return process.env.EDS_PIPELINE_DB_PATH
    ? resolve(process.env.EDS_PIPELINE_DB_PATH)
    : resolve(configRoot(), process.env.EDS_IMPORT_EXPERIMENTAL === '1' ? 'pipeline-experimental.db' : 'pipeline.db');
}
