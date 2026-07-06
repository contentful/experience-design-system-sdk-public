import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Spec lock for "drop the credential-test-gate" change.
 *
 * After this change, the wizard must:
 *   1. Never set `step: 'credential-test-gate'` (the gate is no longer reachable).
 *   2. Never render a `<GateStep>` case for the 'credential-test-gate' step
 *      (no "Test credentials" / "Skip and continue" prompt).
 *
 * The literal `'credential-test-gate'` is intentionally retained in the
 * `WizardStep` union for back-compat (mirroring how `'validating-credentials'`
 * was preserved after PR #54), so we don't assert it's gone from the type.
 */

const here = dirname(fileURLToPath(import.meta.url));
const wizardAppPath = resolve(here, '../../../src/import/tui/WizardApp.tsx');

describe('WizardApp — credential-test-gate is dropped', () => {
  it('never sets step: "credential-test-gate"', async () => {
    const src = await readFile(wizardAppPath, 'utf8');
    expect(src).not.toMatch(/step:\s*[\'"]credential-test-gate[\'"]/);
  });

  it('does not render a case branch for "credential-test-gate"', async () => {
    const src = await readFile(wizardAppPath, 'utf8');
    expect(src).not.toMatch(/case\s+[\'"]credential-test-gate[\'"]\s*:/);
  });

  it('does not contain the gate prompt labels', async () => {
    const src = await readFile(wizardAppPath, 'utf8');
    expect(src).not.toContain('Test credentials');
    expect(src).not.toContain('Skip and continue');
  });
});
