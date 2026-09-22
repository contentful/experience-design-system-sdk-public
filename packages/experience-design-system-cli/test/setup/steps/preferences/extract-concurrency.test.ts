import { cpus } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractConcurrency } from '@contentful/experience-design-system-extraction';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('extractConcurrency', () => {
  it('falls back to one worker per CPU core when unset', () => {
    vi.stubEnv('EDS_EXTRACT_CONCURRENCY', '');
    expect(extractConcurrency()).toBe(cpus().length);
  });

  it('uses the environment value the CLI fills in from the stored preference', () => {
    vi.stubEnv('EDS_EXTRACT_CONCURRENCY', '8');
    expect(extractConcurrency()).toBe(8);
  });

  it('reads the environment on every call, not once at import', () => {
    // The CLI sets this while starting up, after the extraction modules have
    // already been imported — so a value cached at module load would be missed.
    vi.stubEnv('EDS_EXTRACT_CONCURRENCY', '2');
    expect(extractConcurrency()).toBe(2);
    vi.stubEnv('EDS_EXTRACT_CONCURRENCY', '5');
    expect(extractConcurrency()).toBe(5);
  });

  it('ignores a value that is not a positive number', () => {
    vi.stubEnv('EDS_EXTRACT_CONCURRENCY', 'lots');
    expect(extractConcurrency()).toBe(cpus().length);
    vi.stubEnv('EDS_EXTRACT_CONCURRENCY', '0');
    expect(extractConcurrency()).toBe(cpus().length);
  });
});
