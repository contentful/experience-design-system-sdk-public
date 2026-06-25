import { describe, it, expect } from 'vitest';
import { buildRunTeaserLine } from '../../../src/import/tui/run-teaser.js';

describe('buildRunTeaserLine', () => {
  it('renders the teaser with the run id', () => {
    expect(buildRunTeaserLine('01HXYZ')).toBe(
      "Run saved as 01HXYZ — re-export with 'experiences export 01HXYZ' or modify with 'experiences modify 01HXYZ'.",
    );
  });

  it('returns empty when run id is missing (no record was appended)', () => {
    expect(buildRunTeaserLine(null)).toBe('');
    expect(buildRunTeaserLine(undefined)).toBe('');
  });
});
