import { describe, expect, it } from 'vitest';
import { createZip } from '../src/tui/zip.js';
import { readZip } from './helpers/read-zip.js';

// The zip is the one thing the user sends to support, so it has to open with an ordinary unzip tool.
describe('createZip', () => {
  it('holds every file with its name and contents intact, including a long repetitive log and a non-ASCII name', () => {
    const when = new Date(2026, 10, 6, 9, 30, 12);
    const log = `## Outputs\n${'{"outcome":"failed at push"}\n'.repeat(2000)}`;

    const zip = createZip([
      { name: 'import/04-credentials/credentials-attempt-1.md', data: Buffer.from('# Credentials'), modified: when },
      { name: 'import/10-publish/pünkt-attempt-1.md', data: Buffer.from(log), modified: when },
    ]);

    const entries = readZip(zip);
    expect(entries.map((entry) => entry.name)).toEqual([
      'import/04-credentials/credentials-attempt-1.md',
      'import/10-publish/pünkt-attempt-1.md',
    ]);
    expect(entries[0]!.data.toString()).toBe('# Credentials');
    expect(entries[1]!.data.toString()).toBe(log);
    // The repetitive log must actually be compressed.
    expect(zip.length).toBeLessThan(log.length / 4);
  });

  it('makes a valid archive with nothing in it', () => {
    expect(readZip(createZip([]))).toEqual([]);
  });
});
