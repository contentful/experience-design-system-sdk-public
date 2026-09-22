/**
 * Tier 3b — custom prompt paths.
 *
 * `--select-prompt-path` is threaded into the headless pipeline; it
 * emits a "Custom prompt active for select" warning to stderr with
 * the resolved path. `--generate-prompt-path` is wizard-only; we test
 * it via PTY in a companion file.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../helpers/run-cli.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { REACT_MINIMAL } from '../helpers/fixtures.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUB_AGENT = resolve(HERE, '../../src/stub-agent.mjs');

function stubEnv(extra = {}) {
  return {
    EDS_AGENT_BINARY_CLAUDE: STUB_AGENT,
    EDS_AGENT_BINARY_CODEX: STUB_AGENT,
    EDS_AGENT_BINARY_OPENCODE: STUB_AGENT,
    EDS_AGENT_BINARY_CURSOR: STUB_AGENT,
    ...extra,
  };
}

describe('experiences import — --select-prompt-path (headless)', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  function isolated() {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);
    return { ...t.env, ...stubEnv() };
  }

  function makePrompt(name = 'select-prompt.md', body = '# Custom select prompt\n') {
    const dir = mkdtempSync(join(tmpdir(), 'eds-prompt-'));
    cleanups.push(() => {
      // No recursive rmdir needed — test's tmpHome cleanup takes care of siblings;
      // this dir is separate but small.
    });
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  }

  it('--select-prompt-path emits the "Custom prompt active for select" banner and echoes the resolved path', async () => {
    const promptPath = makePrompt();
    const { code, stderr } = await runCli(
      [
        'import',
        '--project',
        REACT_MINIMAL,
        '--skip-apply',
        '--print-prompt',
        '--select-prompt-path',
        promptPath,
      ],
      { env: isolated() },
    );
    expect(code).toBe(0);
    expect(stderr).toMatch(/Custom prompt active for select:/);
    expect(stderr).toContain(promptPath);
    // And the "bundled invariants" waiver appears — reminds the operator
    // that the guardrails don't run when using a custom prompt.
    expect(stderr).toMatch(/Bundled invariants.*do NOT apply/i);
  });

  it('a custom prompt path that does not end in .md still runs, with a warning', async () => {
    const promptPath = makePrompt('custom-prompt.txt', '# Not .md\n');
    const { code, stderr } = await runCli(
      [
        'import',
        '--project',
        REACT_MINIMAL,
        '--skip-apply',
        '--print-prompt',
        '--select-prompt-path',
        promptPath,
      ],
      { env: isolated() },
    );
    expect(code).toBe(0);
    expect(stderr).toMatch(/custom prompt path does not end in \.md/i);
    expect(stderr).toContain(promptPath);
  });
});
