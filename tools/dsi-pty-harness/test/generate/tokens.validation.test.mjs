/**
 * Tier 5 — `experiences generate tokens`.
 *
 * --dry-run prints the built prompt to stdout and exits. Sweeps the four
 * raw-token formats (SCSS/CSS/JS/Style Dictionary) so we know the
 * prompt-builder ingests each without erroring.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runCli } from '../helpers/run-cli.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS_DIR = resolve(HERE, '..', '..', 'fixtures', 'tokens');

describe('generate tokens', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('errors when --raw-tokens is omitted', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { stderr, code } = await runCli(
      ['generate', 'tokens', '--agent', 'claude', '--dry-run'],
      { env: t.env },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--raw-tokens is required/);
  });

  for (const file of ['vars.scss', 'vars.css', 'vars.js', 'style-dictionary.json']) {
    it(`--dry-run with ${file} builds a prompt`, async () => {
      const t = makeTmpHome();
      cleanups.push(t.cleanup);
      const rawTokens = resolve(TOKENS_DIR, file);
      const { stdout, code } = await runCli(
        [
          'generate',
          'tokens',
          '--raw-tokens',
          rawTokens,
          '--agent',
          'claude',
          '--dry-run',
        ],
        { env: t.env },
      );
      expect(code).toBe(0);
      // The built prompt is substantial and includes at least one of the
      // token names that survives verbatim through prompt assembly.
      expect(stdout.length).toBeGreaterThan(500);
      expect(stdout).toMatch(/primary|color|token/i);
    });
  }

  it('--raw-tokens with a nonexistent path exits 1', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    const { stderr, code } = await runCli(
      [
        'generate',
        'tokens',
        '--raw-tokens',
        '/tmp/no-such-tokens-xyz.scss',
        '--agent',
        'claude',
        '--dry-run',
      ],
      { env: t.env },
    );
    expect(code).toBe(1);
    expect(stderr).toMatch(/--raw-tokens|not found|does not exist/);
  });
});
