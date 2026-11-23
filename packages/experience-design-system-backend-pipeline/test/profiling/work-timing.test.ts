import { afterEach, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { ImportWorkTiming } from '../../src/profiling/work-timing.js';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it('subtracts nested measurements so traversal and token scans do not count I/O twice', () => {
  vi.stubEnv('EDS_IMPORT_PROFILE_DIR', '');
  vi.spyOn(performance, 'now')
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(2)
    .mockReturnValueOnce(5)
    .mockReturnValueOnce(10)
    .mockReturnValueOnce(10);
  const timing = new ImportWorkTiming('example');
  timing.measure('traversalMs', () => timing.measure('fileReadMs', () => 42));
  timing.end();
  expect(timing.work).toEqual({ traversalMs: 7, fileReadMs: 3, otherMs: 0 });
});
