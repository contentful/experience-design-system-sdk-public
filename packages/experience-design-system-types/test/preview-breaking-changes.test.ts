import { describe, expect, it } from 'vitest';
import { sanitizeBreakingChanges } from '../src/index.js';

describe('sanitizeBreakingChanges', () => {
  it('keeps known property and slot reasons', () => {
    const input = [
      { propertyId: 'title', reason: 'removed' },
      { slotId: 'body', reason: 'slot_allowed_components_narrowed' },
      { slotId: 'body', reason: 'slot_became_required' },
      { slotId: 'footer', reason: 'slot_added_required' },
      { slotId: 'items', reason: 'slot_cardinality_narrowed' },
    ];
    expect(sanitizeBreakingChanges(input)).toEqual(input);
  });

  it('drops unknown reasons and reasons on the wrong kind of row', () => {
    expect(
      sanitizeBreakingChanges([
        { propertyId: 'title', reason: 'renamed' },
        { slotId: 'body', reason: 'slot_renamed' },
        { slotId: 'body', reason: 'removed' },
        { propertyId: 'title', reason: 'slot_removed' },
      ]),
    ).toEqual([]);
  });

  it('drops malformed rows', () => {
    expect(
      sanitizeBreakingChanges([
        null,
        'removed',
        [],
        { reason: 'removed' },
        { propertyId: '', reason: 'removed' },
        { propertyId: 1, reason: 'removed' },
        { propertyId: 'a', slotId: 'b', reason: 'removed' },
        { propertyId: 'a', reason: 'removed', extra: true },
      ]),
    ).toEqual([]);
  });

  it('returns an empty list for non-arrays', () => {
    expect(sanitizeBreakingChanges(undefined)).toEqual([]);
    expect(sanitizeBreakingChanges({ propertyId: 'a', reason: 'removed' })).toEqual([]);
  });

  it('returns copies, not the input rows', () => {
    const row = { propertyId: 'title', reason: 'removed' };
    const [out] = sanitizeBreakingChanges([row]);
    expect(out).toEqual(row);
    expect(out).not.toBe(row);
  });
});
