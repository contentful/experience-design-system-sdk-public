import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Regression tests for INTEG-4410: credentials edited via `experiences setup`
 * or via the wizard's credentials step must always be persisted to
 * ~/.config/experiences/credentials.json — even when the operator submits
 * without changing any field (the "unchanged" path used to route through
 * `onContinue` → `advanceWithCredentials`, which never writes to disk).
 *
 * These are source-level pins on WizardApp.tsx (following the pattern used
 * by `credentials-no-test-gate.test.tsx`): they refuse a regression where
 * `onContinue` is wired to a helper that skips `writeExperiencesCredentials`.
 * The functional persistence behavior is exercised by `credentials-store.test.ts`
 * (disk-wins-over-env precedence).
 */

const here = dirname(fileURLToPath(import.meta.url));
const wizardAppPath = resolve(here, '../../../src/import/tui/WizardApp.tsx');

describe('WizardApp — credentials always persisted (INTEG-4410)', () => {
  it('binds CredentialsStep.onContinue to a handler that writes credentials to disk', async () => {
    const src = await readFile(wizardAppPath, 'utf8');
    const idx = src.indexOf('<CredentialsStep');
    expect(idx).toBeGreaterThan(-1);
    const end = src.indexOf('/>', idx);
    const block = src.slice(idx, end);
    // Pre-fix wiring routed `onContinue` at `advanceWithCredentials`, which
    // mutates state but never calls `writeExperiencesCredentials`.
    // Fix unifies both branches so both go through a persist-first helper.
    expect(block).toMatch(/onContinue=\{[^}]*confirmCredentials/);
    expect(block).not.toMatch(/onContinue=\{advanceWithCredentials\}/);
  });

  it('confirmCredentials writes to disk before validating', async () => {
    const src = await readFile(wizardAppPath, 'utf8');
    const idx = src.indexOf('const confirmCredentials');
    expect(idx).toBeGreaterThan(-1);
    const chunk = src.slice(idx, idx + 800);
    const writeIdx = chunk.indexOf('writeExperiencesCredentials');
    const advanceIdx = chunk.indexOf('advanceWithCredentials');
    expect(writeIdx).toBeGreaterThan(-1);
    expect(advanceIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeLessThan(advanceIdx);
  });
});
