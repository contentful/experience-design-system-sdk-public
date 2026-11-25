import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join, resolve } from 'node:path';
import { getPipelineDbPath } from '../src/session/helpers/pipeline-db-path.js';

describe('getPipelineDbPath', () => {
  const home = resolve('/tmp/eds-home-test');

  beforeEach(() => {
    vi.stubEnv('EDS_HOME', home);
    vi.stubEnv('EDS_PIPELINE_DB_PATH', '');
    vi.stubEnv('EDS_IMPORT_EXPERIMENTAL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses pipeline.db under the config root by default', () => {
    expect(getPipelineDbPath()).toBe(join(home, 'pipeline.db'));
  });

  it('uses pipeline-experimental.db when EDS_IMPORT_EXPERIMENTAL=1', () => {
    vi.stubEnv('EDS_IMPORT_EXPERIMENTAL', '1');
    expect(getPipelineDbPath()).toBe(join(home, 'pipeline-experimental.db'));
  });

  it('prefers EDS_PIPELINE_DB_PATH over the experimental switch', () => {
    vi.stubEnv('EDS_IMPORT_EXPERIMENTAL', '1');
    vi.stubEnv('EDS_PIPELINE_DB_PATH', '/tmp/custom.db');
    expect(getPipelineDbPath()).toBe(resolve('/tmp/custom.db'));
  });
});
