import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runCliWithEnv } from '../helpers/cli-runner.js';
import { createTestFixture, type TestFixture } from '../helpers/fixtures.js';

describe('import — headless mode', () => {
  let fixture: TestFixture;

  beforeAll(async () => {
    fixture = await createTestFixture();
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  const baseEnv = () => ({
    EDS_PIPELINE_DB_PATH: fixture.dbPath,
    NODE_NO_WARNINGS: '1',
  });

  it('fails when --project points to nonexistent directory', async () => {
    // analyze extract will fail when the project directory doesn't exist
    const { code } = await runCliWithEnv(
      ['import', '--project', '/nonexistent/path/does/not/exist'],
      baseEnv(),
      30000,
    );
    expect(code).not.toBe(0);
  });
});
