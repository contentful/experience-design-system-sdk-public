import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Regression tests: after the operator types new credentials into the
 * wizard's credentials step and they pass validation, the wizard state must
 * be updated with the newly-entered spaceId/environmentId/cmaToken/host.
 *
 * Previously `validateCredentials`'s success path stashed the freshly-typed
 * values in a `credentialsRef` that nothing else ever read, and never called
 * `update(...)` with them. Every downstream screen (preview, final-review)
 * and the actual push call continued reading the stale `state.spaceId` /
 * `state.environmentId` / `state.cmaToken` / `state.host` set before the
 * edit — so a manually-typed space id would validate successfully but the
 * push would still go to the old space, producing a visible space-id
 * mismatch.
 */

const here = dirname(fileURLToPath(import.meta.url));
const wizardAppPath = resolve(here, '../../../src/import/tui/WizardApp.tsx');

describe('WizardApp — validated credentials sync into state', () => {
  it('validateCredentials writes the newly-entered spaceId/environmentId/cmaToken/host into state after validateToken succeeds', async () => {
    const src = await readFile(wizardAppPath, 'utf8');
    const idx = src.indexOf('const validateCredentials');
    expect(idx).toBeGreaterThan(-1);
    const chunk = src.slice(idx, idx + 1200);

    const validateTokenIdx = chunk.indexOf('.validateToken()');
    expect(validateTokenIdx).toBeGreaterThan(-1);

    const updateIdx = chunk.indexOf('update(', validateTokenIdx);
    expect(updateIdx).toBeGreaterThan(-1);
    const updateCallEnd = chunk.indexOf(')', updateIdx);
    const updateCall = chunk.slice(updateIdx, updateCallEnd);

    expect(updateCall).toMatch(/\bspaceId\b/);
    expect(updateCall).toMatch(/\benvironmentId\b/);
    expect(updateCall).toMatch(/\bcmaToken\b/);
    expect(updateCall).toMatch(/host:\s*resolvedHost/);
  });

  it('does not leave the validated credentials stranded in an unread ref', async () => {
    const src = await readFile(wizardAppPath, 'utf8');
    // Pre-fix, a dead `credentialsRef` captured the typed credentials but
    // nothing downstream ever read `credentialsRef.current`, so state
    // (and therefore the actual push) stayed on the stale values.
    expect(src).not.toMatch(/credentialsRef/);
  });
});
