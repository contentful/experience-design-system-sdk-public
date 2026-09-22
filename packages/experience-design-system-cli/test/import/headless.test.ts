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

  it('runs with --skip-analyze --skip-generate --skip-apply and exits 0', async () => {
    const { code } = await runCliWithEnv(
      ['import', '--skip-analyze', '--skip-generate', '--skip-apply', '--project', fixture.projectDir],
      baseEnv(),
    );
    expect(code).toBe(0);
  });

  it('outputs JSON to stdout when not a TTY', async () => {
    const { code, stdout } = await runCliWithEnv(
      ['import', '--skip-analyze', '--skip-generate', '--skip-apply', '--project', fixture.projectDir],
      baseEnv(),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('steps');
    expect(Array.isArray(parsed.steps)).toBe(true);
  });

  it('JSON output includes session and project fields', async () => {
    const { code, stdout } = await runCliWithEnv(
      ['import', '--skip-analyze', '--skip-generate', '--skip-apply', '--project', fixture.projectDir],
      baseEnv(),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('session');
    expect(typeof parsed.session).toBe('string');
    expect(parsed).toHaveProperty('project');
    expect(typeof parsed.project).toBe('string');
  });

  it('all steps are skipped when --skip-analyze --skip-generate --skip-apply are set', async () => {
    const { code, stdout } = await runCliWithEnv(
      ['import', '--skip-analyze', '--skip-generate', '--skip-apply', '--project', fixture.projectDir],
      baseEnv(),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { steps: { step: string; status: string }[] };
    expect(parsed.steps.every((s) => s.status === 'skipped')).toBe(true);
  });

  it('fails when --project points to nonexistent directory', async () => {
    // analyze extract will fail when the project directory doesn't exist
    const { code } = await runCliWithEnv(
      ['import', '--project', '/nonexistent/path/does/not/exist', '--skip-generate', '--skip-apply', '--select-all'],
      baseEnv(),
      30000,
    );
    expect(code).not.toBe(0);
  });
});
