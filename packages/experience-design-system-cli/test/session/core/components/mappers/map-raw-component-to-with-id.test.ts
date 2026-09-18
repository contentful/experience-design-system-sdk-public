import { describe, it, expect } from 'vitest';
import { mapRawComponentToWithId } from '../../../../../src/session/core/components/mappers/map-raw-component-to-with-id.js';
import type { RawComponentRow } from '../../../../../src/session/repositories/components/raw/interfaces/raw-component-row.js';

function row(overrides: Partial<RawComponentRow> = {}): RawComponentRow {
  return {
    component_id: 'c1',
    name: 'Button',
    source: '/tmp/Button.tsx',
    framework: 'react',
    extraction_confidence: null,
    review_reasons: '[]',
    needs_review: 0,
    source_path: null,
    ...overrides,
  };
}

describe('mapRawComponentToWithId', () => {
  it('produces the minimal shape when only required columns are set', () => {
    expect(mapRawComponentToWithId(row(), [], [])).toEqual({
      component_id: 'c1',
      name: 'Button',
      source: '/tmp/Button.tsx',
      framework: 'react',
      extractionConfidence: null,
      reviewReasons: [],
      needsReview: false,
      sourcePath: undefined,
      props: [],
      slots: [],
    });
  });

  it('parses review_reasons JSON and coerces needs_review to boolean', () => {
    const out = mapRawComponentToWithId(
      row({ needs_review: 1, review_reasons: '["ambiguous-type","low-confidence"]' }),
      [],
      [],
    );
    expect(out.needsReview).toBe(true);
    expect(out.reviewReasons).toEqual(['ambiguous-type', 'low-confidence']);
  });

  it('recovers from malformed review_reasons JSON to an empty array', () => {
    const out = mapRawComponentToWithId(row({ review_reasons: 'not-json' }), [], []);
    expect(out.reviewReasons).toEqual([]);
  });

  it('drops non-string entries in review_reasons', () => {
    const out = mapRawComponentToWithId(row({ review_reasons: '["ok", 42, null, "also-ok"]' }), [], []);
    expect(out.reviewReasons).toEqual(['ok', 'also-ok']);
  });

  it('passes props and slots through unchanged', () => {
    const props = [{ name: 'label', type: 'string', required: true }];
    const slots = [{ name: 'children', isDefault: true }];
    const out = mapRawComponentToWithId(row(), props, slots);
    expect(out.props).toBe(props);
    expect(out.slots).toBe(slots);
  });

  it('surfaces source_path as sourcePath and extraction_confidence when set', () => {
    const out = mapRawComponentToWithId(
      row({ source_path: '/abs/path/Button.tsx', extraction_confidence: 92 }),
      [],
      [],
    );
    expect(out.sourcePath).toBe('/abs/path/Button.tsx');
    expect(out.extractionConfidence).toBe(92);
  });
});
