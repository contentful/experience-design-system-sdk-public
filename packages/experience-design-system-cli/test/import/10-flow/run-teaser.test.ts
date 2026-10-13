import { describe, it, expect } from 'vitest';
import { buildRunTeaserLine } from '../../../src/tui/import/steps/10-flow/support/run-teaser.js';

describe('buildRunTeaserLine', () => {
  it('renders the saved run teaser', () => {
    expect(buildRunTeaserLine('01HXYZ')).toBe('Run saved as 01HXYZ.');
  });

  it('returns empty when run id is missing (no record was appended)', () => {
    expect(buildRunTeaserLine(null)).toBe('');
    expect(buildRunTeaserLine(undefined)).toBe('');
  });
});
