/**
 * Tier 3b — `--generate-prompt-path` is wizard-only (not threaded into
 * headless runPipeline). Assert the CustomPromptBanner renders with the
 * override path when the wizard reaches the generate step.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnWizard } from '../../src/harness.mjs';
import { makeTmpHome } from '../helpers/tmp-home.mjs';
import { REACT_MINIMAL } from '../helpers/fixtures.mjs';

describe('experiences import — --generate-prompt-path (PTY)', () => {
  const cleanups = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()();
  });

  it('renders the "Custom prompt active" banner with the generate-prompt path', async () => {
    const t = makeTmpHome();
    cleanups.push(t.cleanup);

    const promptDir = mkdtempSync(join(tmpdir(), 'eds-genprompt-'));
    const promptPath = join(promptDir, 'gen.md');
    writeFileSync(promptPath, '# Custom generate prompt for tests\n');

    const w = await spawnWizard(
      [
        'import',
        '--project',
        REACT_MINIMAL,
        '--auto-accept-scope',
        '--no-push',
        '--no-auto-filter',
        '--generate-prompt-path',
        promptPath,
      ],
      { env: t.env, cols: 200, rows: 60 },
    );
    cleanups.push(() => w.close());

    await w.waitFor('Design tokens', { timeout: 10000 });
    w.writeKey('s');
    await w.waitFor(/Found \d+ files/, { timeout: 8000 });
    w.writeKey('enter');

    // The banner renders somewhere along the generate → save flow.
    await w.waitFor(/Custom prompt active/, { timeout: 30000 });
    const screen = w.getScreen();
    expect(screen).toMatch(/Custom prompt active/);
    // The banner echoes the path so operators can spot a mistake.
    expect(screen).toContain(promptPath);
  });
});
