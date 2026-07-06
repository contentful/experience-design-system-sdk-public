import { describe, it, expect } from 'vitest';
import { buildRunTeaserLine } from '../../../src/import/tui/run-teaser.js';

describe('buildRunTeaserLine', () => {
  it('renders the teaser with push-from-run and modify shortcuts', () => {
    expect(buildRunTeaserLine('01HXYZ')).toBe(
      "Run saved as 01HXYZ — push to Contentful with 'experiences import --push-from-run 01HXYZ' or modify with 'experiences import --modify 01HXYZ'.",
    );
  });

  it('returns empty when run id is missing (no record was appended)', () => {
    expect(buildRunTeaserLine(null)).toBe('');
    expect(buildRunTeaserLine(undefined)).toBe('');
  });
});
