import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const scripts = new URL('../../../../scripts/import-profiling/', import.meta.url);

describe('operational profiling ownership', () => {
  it('keeps process sampling and launching behind the backend boundary', async () => {
    for (const name of ['processes.mjs', 'run.mjs']) {
      const source = await readFile(new URL(name, scripts), 'utf8');
      expect(source).not.toMatch(/node:(?:child_process|timers\/promises)|\b(?:spawn|execFile|sampleProcessTree)\(/);
      expect(source).toContain('dist/src/profiling/');
    }
  });

  it('keeps raw profile readback and metric calculations behind the backend boundary', async () => {
    const source = await readFile(new URL('report.mjs', scripts), 'utf8');
    expect(source).not.toMatch(/createReadStream|JSON\.parse|function summarizeResources|function traceEvents/);
    expect(source).not.toContain('export function summarizeProfile');
    expect(source).toContain('dist/src/profiling/');
    expect(source).toContain('export function renderProfileReport');
  });
});
