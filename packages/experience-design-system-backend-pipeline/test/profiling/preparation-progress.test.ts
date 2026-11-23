import { expect, it, vi, afterEach } from 'vitest';
import { withImportProfileDirectory, profileImportSync } from '../../src/profiling/import-profile.js';
import { collectPreparationProgress, boundPreparationProgress } from '../../src/profiling/preparation-progress.js';
afterEach(() => vi.unstubAllEnvs());
it('reports bounded preparation transitions even with resource profiling disabled', () => {
  vi.stubEnv('EDS_IMPORT_PROFILE_DIR', '');
  const updates: any[] = [];
  withImportProfileDirectory(
    '/unused',
    () => profileImportSync('source.digest.envelope', () => 42),
    collectPreparationProgress((steps) => updates.push(steps)),
  );
  expect(updates[0]).toMatchObject([{ id: 'source.digest.envelope', status: 'running' }]);
  expect(updates[1]).toMatchObject([{ id: 'source.digest.envelope', status: 'complete' }]);
  expect(boundPreparationProgress(updates[1])).toEqual(updates[1]);
  expect(boundPreparationProgress([{ ...updates[1][0], label: 'untrusted label' }])?.[0]?.label).toBe(
    'Verify saved evidence envelope',
  );
  expect(boundPreparationProgress([{ id: 'unknown', status: 'running', elapsedMs: 0 }])).toBeUndefined();
  expect(boundPreparationProgress([{ ...updates[1][0], elapsedMs: Infinity }])).toBeUndefined();
});
it('contains observer failures and reports preparation failure without payloads', () => {
  vi.stubEnv('EDS_IMPORT_PROFILE_DIR', '');
  const updates: any[] = [];
  expect(() =>
    withImportProfileDirectory(
      '/unused',
      () =>
        profileImportSync('evidence.owners', () => {
          throw new Error('private');
        }),
      collectPreparationProgress((steps) => updates.push(steps)),
    ),
  ).toThrow('private');
  expect(updates[1]).toMatchObject([{ status: 'failed' }]);
  expect(JSON.stringify(updates)).not.toContain('private');
  expect(
    withImportProfileDirectory(
      '/unused',
      () => profileImportSync('evidence.owners', () => 42),
      () => {
        throw new Error('observer');
      },
    ),
  ).toBe(42);
});
