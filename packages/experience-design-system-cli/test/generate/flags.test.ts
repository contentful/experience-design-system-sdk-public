import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolve } from 'node:path';
import { runCli, runCliWithEnv } from '../helpers/cli-runner.js';
import { createTestFixture, type TestFixture } from '../helpers/fixtures.js';

describe('generate components — flag variations', () => {
  let fixture: TestFixture;

  beforeAll(async () => {
    fixture = await createTestFixture();
  });

  afterAll(async () => {
    await fixture.cleanup();
  });

  const tokensPath = resolve(import.meta.dirname, '../fixtures/valid-tokens.json');

  const baseEnv = () => ({
    EDS_PIPELINE_DB_PATH: fixture.dbPath,
    NODE_NO_WARNINGS: '1',
  });

  it('prints help with --help', async () => {
    const { stdout, code } = await runCli(['generate', 'components', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--session');
    expect(stdout).toContain('--agent');
    expect(stdout).toContain('--tokens');
  });

  it('--dry-run prints the prompt without invoking agent', async () => {
    const { stdout, stderr, code } = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', '--session', fixture.sessionId, '--dry-run'],
      baseEnv(),
    );
    expect(code).toBe(0);
    expect(stdout.length + stderr.length).toBeGreaterThan(0);
  });

  it('fails with invalid --session', async () => {
    const { code } = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', '--session', 'nonexistent-session-id'],
      baseEnv(),
    );
    expect(code).not.toBe(0);
  });

  it('fails when --agent is not recognized', async () => {
    const { code } = await runCliWithEnv(
      ['generate', 'components', '--session', fixture.sessionId, '--agent', 'fake-agent-xyz'],
      baseEnv(),
    );
    expect(code).not.toBe(0);
  });

  it('--tokens flag is accepted with valid path', async () => {
    const { code } = await runCliWithEnv(
      [
        'generate',
        'components',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--dry-run',
        '--tokens',
        tokensPath,
      ],
      baseEnv(),
    );
    expect(code).toBe(0);
  });

  it('--token-map flag appears in help', async () => {
    const { stdout, code } = await runCli(['generate', 'components', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('--token-map');
  });

  it('--model flag is accepted (with --dry-run)', async () => {
    const { code } = await runCliWithEnv(
      [
        'generate',
        'components',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--dry-run',
        '--model',
        'claude-3-5-sonnet-20241022',
      ],
      baseEnv(),
    );
    expect(code).toBe(0);
  });

  it('--no-cache flag is accepted (with --dry-run)', async () => {
    const { code } = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', '--session', fixture.sessionId, '--dry-run', '--no-cache'],
      baseEnv(),
    );
    expect(code).toBe(0);
  });

  it('--verbose flag is accepted (with --dry-run)', async () => {
    const { code } = await runCliWithEnv(
      ['generate', 'components', '--agent', 'claude', '--session', fixture.sessionId, '--dry-run', '--verbose'],
      baseEnv(),
    );
    expect(code).toBe(0);
  });

  it('--dry-run + --tokens + --model combined', async () => {
    const { code } = await runCliWithEnv(
      [
        'generate',
        'components',
        '--agent',
        'claude',
        '--session',
        fixture.sessionId,
        '--dry-run',
        '--tokens',
        tokensPath,
        '--model',
        'claude-3-5-sonnet-20241022',
      ],
      baseEnv(),
    );
    expect(code).toBe(0);
  });

  describe('--generate-prompt-path (Feature 8)', () => {
    it('lists the flag in --help', async () => {
      const { stdout, code } = await runCli(['generate', 'components', '--help']);
      expect(code).toBe(0);
      expect(stdout).toContain('--generate-prompt-path');
    });

    it('exits 1 with a clear not-found error when the path does not exist', async () => {
      const { stderr, code } = await runCliWithEnv(
        [
          'generate',
          'components',
          '--agent',
          'claude',
          '--session',
          fixture.sessionId,
          '--generate-prompt-path',
          '/nonexistent/custom-prompt.md',
          '--dry-run',
        ],
        baseEnv(),
      );
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/custom prompt path not found/i);
      expect(stderr).toContain('/nonexistent/custom-prompt.md');
    });

    it('accepts a valid path and emits the warning banner on stderr', async () => {
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eds-cli-custom-'));
      try {
        const customPath = path.join(dir, 'custom-generate.md');
        await fs.writeFile(customPath, '# Custom generate prompt\n', 'utf8');
        const { stderr, code } = await runCliWithEnv(
          [
            'generate',
            'components',
            '--agent',
            'claude',
            '--session',
            fixture.sessionId,
            '--generate-prompt-path',
            customPath,
            '--dry-run',
          ],
          baseEnv(),
        );
        expect(code).toBe(0);
        expect(stderr).toMatch(/Custom prompt active for components/i);
        expect(stderr).toContain(customPath);
        expect(stderr).toMatch(/bundled invariants.*do NOT apply/i);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe('generate tokens', () => {
    it('prints help with --help', async () => {
      const { stdout, code } = await runCli(['generate', 'tokens', '--help']);
      expect(code).toBe(0);
      expect(stdout).toContain('--raw-tokens');
      expect(stdout).toContain('--agent');
    });

    it('fails without --raw-tokens', async () => {
      const { code } = await runCliWithEnv(['generate', 'tokens', '--agent', 'claude'], baseEnv());
      expect(code).not.toBe(0);
    });

    it('--dry-run prints prompt without invoking agent', async () => {
      const { stdout, stderr, code } = await runCliWithEnv(
        ['generate', 'tokens', '--agent', 'claude', '--raw-tokens', '/dev/null', '--dry-run'],
        baseEnv(),
      );
      expect(code).toBe(0);
      expect(stdout.length + stderr.length).toBeGreaterThan(0);
    });

    it('--model flag is accepted (with --dry-run)', async () => {
      const { code } = await runCliWithEnv(
        [
          'generate',
          'tokens',
          '--agent',
          'claude',
          '--raw-tokens',
          '/dev/null',
          '--dry-run',
          '--model',
          'claude-3-5-sonnet-20241022',
        ],
        baseEnv(),
      );
      expect(code).toBe(0);
    });

    it('--verbose flag is accepted (with --dry-run)', async () => {
      const { code } = await runCliWithEnv(
        ['generate', 'tokens', '--agent', 'claude', '--raw-tokens', '/dev/null', '--dry-run', '--verbose'],
        baseEnv(),
      );
      expect(code).toBe(0);
    });

    it('--no-cache flag is accepted (with --dry-run)', async () => {
      const { code } = await runCliWithEnv(
        ['generate', 'tokens', '--agent', 'claude', '--raw-tokens', '/dev/null', '--dry-run', '--no-cache'],
        baseEnv(),
      );
      expect(code).toBe(0);
    });
  });
});
